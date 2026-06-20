import { Client, Events, MessageFlags, ButtonInteraction, ModalSubmitInteraction, ChatInputCommandInteraction } from 'discord.js';
import { configService } from '../../core/config.service';
import { manualRecount } from '../count/count.service';
import { createPanelEmbed, buildPanelComponents } from './panel.service';
import { replyAndDelete, silentCatch } from '../../services/utils';
import { buildCountModal, buildWelcomeModal, buildBypdModal, buildRegistryModal } from './modals';
import { logger } from '../../core/logger';
import { resendStates } from './resend.state';
import { processBypd } from '../bypd/bypd.service';
import { hasBypdInMessage } from '../bypd/bypd.utils';

const PANEL_IDS = new Set([
    'btn_recount_manual', 'btn_cfg_count', 'btn_cfg_welcome', 'btn_cfg_bypd', 'btn_cfg_registry',
    'btn_refresh_config', 'btn_resend_bypd',
    'modal_cfg_count', 'modal_cfg_welcome', 'modal_cfg_bypd', 'modal_cfg_registry',
]);

const MODAL_BUTTONS = ['btn_cfg_count', 'btn_cfg_welcome', 'btn_cfg_bypd', 'btn_cfg_registry'];

export function setupRecountFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i) => {
        // --- /recount command ---
        if (i.isChatInputCommand() && i.commandName === 'recount') {
            const cmd = i as ChatInputCommandInteraction<'cached'>;
            if (!cmd.memberPermissions?.has('Administrator')) {
                await cmd.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
                return;
            }
            await cmd.deferReply({ flags: MessageFlags.Ephemeral });
            await cmd.channel?.send({ embeds: [createPanelEmbed()], components: buildPanelComponents() });
            await replyAndDelete(cmd, '✅ วางแผงควบคุมในห้องนี้แล้ว');
            return;
        }

        // ------------------------------------------
        // BUTTON HANDLING
        // ------------------------------------------
        if (i.isButton() && PANEL_IDS.has(i.customId)) {
            const btn = i as ButtonInteraction<'cached'>;
            if (!btn.memberPermissions?.has('Administrator')) {
                await btn.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
                return;
            }

            // Modal buttons → showModal ทันที (ห้าม defer)
            if (MODAL_BUTTONS.includes(btn.customId)) {
                const modals: Record<string, ReturnType<typeof buildCountModal>> = {
                    'btn_cfg_count': buildCountModal(),
                    'btn_cfg_welcome': buildWelcomeModal(),
                    'btn_cfg_bypd': buildBypdModal(),
                    'btn_cfg_registry': buildRegistryModal(),
                };
                await btn.showModal(modals[btn.customId]).catch(silentCatch('Recount'));
                return;
            }

            // ⭐ เริ่มนับข้อความเก่า → manualRecount จะ defer เองภายใน
            if (btn.customId === 'btn_recount_manual') {
                await manualRecount(client, btn).catch((e: unknown) => logger.error('RECOUNT', `Manual recount error: ${e instanceof Error ? e.message : String(e)}`));
                return;
            }

            // 🔄 รีเฟรช config → deferUpdate + แก้ไข embed เดิม
            if (btn.customId === 'btn_refresh_config') {
                try { await btn.deferUpdate(); } catch { return; }
                await configService.reload();
                try { await btn.editReply({ embeds: [createPanelEmbed()], components: buildPanelComponents() }); } catch (e) { logger.warn('Recount', String(e)); }
                return;
            }

            // 🔄 ส่งย้อนหลัง BYPD → deferReply (ต้อง reply ใหม่)
            if (btn.customId === 'btn_resend_bypd') {
                try { await btn.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
                const guildId = btn.guildId || 'global';
                const state = resendStates.get(guildId);
                if (state?.isRunning) {
                    resendStates.stop(guildId);
                    await refreshPanel(btn);
                    await btn.editReply({ content: `⏹️ หยุดทำงานแล้ว\n📊 ส่งสำเร็จ: ${state.totalSent} | ล้มเหลว: ${state.totalFailed}` });
                    return;
                }
                const abort = new AbortController();
                resendStates.set(guildId, { isRunning: true, abortController: abort, totalSent: 0, totalFailed: 0 });
                await refreshPanel(btn);
                await btn.editReply({ content: '🔄 กำลังส่งย้อนหลัง BYPD...\n⏳ กำลังสแกนห้อง Log...' });
                try {
                    const r = await runResendMissed(btn, abort.signal);
                    resendStates.set(guildId, { isRunning: false, abortController: null, totalSent: r.sent, totalFailed: r.failed });
                    await refreshPanel(btn);
                    await replyAndDelete(btn, r.message);
                } catch (err: unknown) {
                    resendStates.stop(guildId);
                    await refreshPanel(btn);
                    await btn.editReply({ content: `❌ เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}` });
                }
                return;
            }
        }

        // ------------------------------------------
        // MODAL SUBMIT HANDLING
        // ------------------------------------------
        if (i.isModalSubmit() && PANEL_IDS.has(i.customId)) {
            const modal = i as ModalSubmitInteraction<'cached'>;
            if (!modal.memberPermissions?.has('Administrator')) {
                await modal.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
                return;
            }
            try { await modal.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
            try {
                const save = async (keys: [string, string][]) => {
                    await configService.writeConfigKeys(keys);
                    if (modal.message) {
                        try { await modal.message.edit({ embeds: [createPanelEmbed()], components: buildPanelComponents() }); } catch (e) { logger.warn('Recount', String(e)); }
                    }
                };
                switch (modal.customId) {
                    case 'modal_cfg_count': {
                        const raw = modal.fields.getTextInputValue('input_all_channels').split(',');
                        await save([
                            ['SPREADSHEET_ID', modal.fields.getTextInputValue('input_spreadsheet_id').trim()],
                            ['SHEET_NAME', modal.fields.getTextInputValue('input_sheet_name').trim()],
                            ...([1, 2, 3, 4, 5] as const).map((n, idx) => [`CHANNEL_ID_${n}`, (raw[idx] || '').trim()] as [string, string]),
                        ]);
                        await replyAndDelete(modal, '✅ บันทึกตั้งค่านับเคสแล้ว');
                        break;
                    }
                    case 'modal_cfg_welcome':
                        await save([
                            ['WELCOME_CHANNEL_ID', modal.fields.getTextInputValue('input_welcome_channel').trim()],
                            ['LOG_CHANNEL_ID', modal.fields.getTextInputValue('input_log_channel').trim()],
                            ['LOGTIME_CHANNEL_ID', modal.fields.getTextInputValue('input_logtime_channel').trim()],
                        ]);
                        await replyAndDelete(modal, '✅ บันทึกตั้งค่าต้อนรับแล้ว');
                        break;
                    case 'modal_cfg_bypd':
                        await save([
                            ['LOGCASE_CHANNEL_ID', modal.fields.getTextInputValue('input_logcase_channel').trim()],
                            ['BYPD_SEND_CHANNEL_ID', modal.fields.getTextInputValue('input_bypd_send').trim()],
                        ]);
                        await replyAndDelete(modal, '✅ บันทึกตั้งค่า LogCase + BYPD แล้ว');
                        break;
                    case 'modal_cfg_registry':
                        await save([
                            ['REGISTRY_SPREADSHEET_ID', modal.fields.getTextInputValue('input_registry_sheet_id').trim()],
                            ['REGISTRY_SHEET_NAME', modal.fields.getTextInputValue('input_registry_sheet_name').trim()],
                            ['REGISTRY_OUT_SHEET_NAME', modal.fields.getTextInputValue('input_registry_out_sheet').trim()],
                        ]);
                        await replyAndDelete(modal, '✅ บันทึกตั้งค่าชีต PD แล้ว');
                        break;
                }
            } catch (e: unknown) {
                logger.error('RECOUNT', `Modal error: ${e instanceof Error ? e.message : String(e)}`);
                try { await modal.editReply({ content: '❌ เกิดข้อผิดพลาด' }); } catch (e) { logger.warn('Recount', String(e)); }
            }
        }
    });
}

async function refreshPanel(interaction: ButtonInteraction<'cached'>): Promise<void> {
    try {
        if (interaction.message) {
            await interaction.message.edit({ embeds: [createPanelEmbed()], components: buildPanelComponents() });
        }
    } catch (e) { logger.warn('Recount', String(e)); }
}

interface ResendResult {
    sent: number;
    failed: number;
    message: string;
}

async function runResendMissed(interaction: ButtonInteraction<'cached'>, abortSignal: AbortSignal): Promise<ResendResult> {
    const logChannelId = configService.getLogCaseChannelId();
    const guild = interaction.guild;
    if (!logChannelId || !guild) return { sent: 0, failed: 0, message: '❌ ไม่พบห้อง Log' };
    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel || !logChannel.isTextBased()) return { sent: 0, failed: 0, message: '❌ ไม่พบห้อง Log' };
    let scanned = 0, bypdSent = 0, failed = 0, bypdAlready = 0;
    let lastId: string | undefined;
    while (true) {
        if (abortSignal.aborted) break;
        const messages = await logChannel.messages.fetch({ limit: 100, before: lastId });
        if (messages.size === 0) break;
        const batch = [...messages.values()].reverse();
        for (const msg of batch) {
            const hasBypd = hasBypdInMessage(msg);
            const hasCheck = msg.reactions.cache.some((r) => r.emoji.name === '✅');
            if (hasBypd && !hasCheck) {
                try { await processBypd(msg); bypdSent++; } catch { failed++; }
                await new Promise(r => setTimeout(r, 500));
            } else if (hasBypd && hasCheck) {
                bypdAlready++;
            }
        }
        scanned += batch.length;
        lastId = messages.last()?.id;
    }
    return {
        sent: bypdSent,
        failed,
        message: abortSignal.aborted
            ? `⏹️ หยุดส่งย้อนหลังแล้ว\n📊 สแกน: ${scanned} | BYPD: ${bypdSent} | ❌ ${failed}\n📊 เคยส่งแล้ว: BYPD ${bypdAlready}`
            : `✅ ส่งย้อนหลังเสร็จสิ้น\n📊 สแกน: ${scanned} | BYPD: ${bypdSent} | ❌ ${failed}\n📊 เคยส่งแล้ว: BYPD ${bypdAlready}`,
    };
}