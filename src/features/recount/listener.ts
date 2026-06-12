import { Client, Events, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { configService } from '../../core/config.service';
import { manualRecount } from '../count/count.service';
import { createPanelEmbed, buildPanelComponents } from './panel.service';
import { buildCountModal, buildWelcomeModal, buildBypdModal, buildRegistryModal } from './modals';
import { logger } from '../../core/logger';
import { sheetService } from '../../core/sheet.service';
import { SHEETS } from '../../config';
import { resendStates } from './resend.state';
import { processBypd } from '../bypd/bypd.service';

const PANEL_IDS = new Set([
    'btn_recount_manual', 'btn_cfg_count', 'btn_cfg_welcome', 'btn_cfg_bypd', 'btn_cfg_registry',
    'btn_refresh_config', 'btn_resend_bypd',
    'modal_cfg_count', 'modal_cfg_welcome', 'modal_cfg_bypd', 'modal_cfg_registry',
]);

export function setupRecountFeature(client: Client): void {
    // Register /recount
    client.once(Events.ClientReady, async () => {
        try {
            const existing = await client.application?.commands.fetch();
            const old = existing?.find(c => c.name === 'recount');
            if (old) await client.application?.commands.edit(old.id, new SlashCommandBuilder().setName('recount').setDescription('⚙️ แผงควบคุมตั้งค่าและนับยอดเคส'));
            else await client.application?.commands.create(new SlashCommandBuilder().setName('recount').setDescription('⚙️ แผงควบคุมตั้งค่าและนับยอดเคส'));
        } catch (e) { logger.error('RECOUNT', `Register failed: ${e}`); }
    });

    client.on(Events.InteractionCreate, async (i: any) => {
        // Slash command: /recount → send panel
        if (i.isChatInputCommand && i.commandName === 'recount') {
            if (!i.memberPermissions?.has('Administrator')) return i.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            await i.channel.send({ embeds: [createPanelEmbed()], components: buildPanelComponents() });
            return i.editReply({ content: '✅ วางแผงควบคุมในห้องนี้แล้ว' });
        }

        // Button / Modal: only if admin
        const isPanel = (i.isButton || i.isModalSubmit) && PANEL_IDS.has(i.customId);
        if (!isPanel) return;
        if (!i.memberPermissions?.has('Administrator')) {
            return i.reply?.({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
        }

        try {
            await safeDefer(i);

            // --- Resend BYPD toggle ---
            if (i.customId === 'btn_resend_bypd') {
                const guildId = i.guildId || 'global';
                const state = resendStates.get(guildId);

                if (state?.isRunning) {
                    resendStates.stop(guildId);
                    await refreshPanel(i);
                    await i.editReply({ content: `⏹️ หยุดทำงานแล้ว\n📊 ส่งสำเร็จ: ${state.totalSent} | ล้มเหลว: ${state.totalFailed}` });
                    return;
                }

                const abortController = new AbortController();
                resendStates.set(guildId, { isRunning: true, abortController, totalSent: 0, totalFailed: 0 });
                await refreshPanel(i);
                await i.editReply({ content: '🔄 กำลังส่งย้อนหลัง BYPD...\n⏳ กำลังสแกนห้อง Log...' });

                try {
                    const result = await runResendMissed(client, i, abortController.signal);
                    resendStates.set(guildId, { isRunning: false, abortController: null, totalSent: result.sent, totalFailed: result.failed });
                    await refreshPanel(i);
                    await i.editReply({ content: result.message });
                } catch (err: any) {
                    resendStates.stop(guildId);
                    await refreshPanel(i);
                    await i.editReply({ content: `❌ เกิดข้อผิดพลาด: ${err.message}` });
                }
                return;
            }

            switch (i.customId) {
                // --- Refresh config ---
                case 'btn_refresh_config': {
                    await configService.reload();
                    await i.editReply({ embeds: [createPanelEmbed()], components: buildPanelComponents() }).catch(() => {});
                    break;
                }

                // --- Manual recount ---
                case 'btn_recount_manual': {
                    await manualRecount(client, i);
                    break;
                }

                // --- Show modals ---
                case 'btn_cfg_count': return i.showModal(buildCountModal()).catch(() => {});
                case 'btn_cfg_welcome': return i.showModal(buildWelcomeModal()).catch(() => {});
                case 'btn_cfg_bypd': return i.showModal(buildBypdModal()).catch(() => {});
                case 'btn_cfg_registry': return i.showModal(buildRegistryModal()).catch(() => {});

                // --- Modal submits ---
                case 'modal_cfg_count': {
                    const raw = i.fields.getTextInputValue('input_all_channels').split(',');
                    await configService.writeConfigKeys([
                        ['SPREADSHEET_ID', i.fields.getTextInputValue('input_spreadsheet_id').trim()],
                        ['SHEET_NAME', i.fields.getTextInputValue('input_sheet_name').trim()],
                    ...([1, 2, 3, 4, 5] as const).map((n, idx) => [`CHANNEL_ID_${n}`, (raw[idx] || '').trim()] as [string, string]),
                    ]);
                    await i.editReply({ content: '✅ บันทึกตั้งค่านับเคสแล้ว' });
                    break;
                }
                case 'modal_cfg_welcome': {
                    await configService.writeConfigKeys([
                        ['WELCOME_CHANNEL_ID', i.fields.getTextInputValue('input_welcome_channel').trim()],
                        ['LOG_CHANNEL_ID', i.fields.getTextInputValue('input_log_channel').trim()],
                        ['LOGTIME_CHANNEL_ID', i.fields.getTextInputValue('input_logtime_channel').trim()],
                    ]);
                    await i.editReply({ content: '✅ บันทึกตั้งค่าต้อนรับแล้ว' });
                    break;
                }
                case 'modal_cfg_bypd': {
                    await configService.writeConfigKeys([
                        ['LOGCASE_CHANNEL_ID', i.fields.getTextInputValue('input_logcase_channel').trim()],
                        ['BYPD_SEND_CHANNEL_ID', i.fields.getTextInputValue('input_bypd_send').trim()],
                        ['PROCTOR_CHANNEL_ID', i.fields.getTextInputValue('input_proctor_channel').trim()],
                    ]);
                    await i.editReply({ content: '✅ บันทึกตั้งค่า LogCase + BYPD + Proctor แล้ว' });
                    break;
                }
                case 'modal_cfg_registry': {
                    await configService.writeConfigKeys([
                        ['REGISTRY_SPREADSHEET_ID', i.fields.getTextInputValue('input_registry_sheet_id').trim()],
                        ['REGISTRY_SHEET_NAME', i.fields.getTextInputValue('input_registry_sheet_name').trim()],
                        ['REGISTRY_OUT_SHEET_NAME', i.fields.getTextInputValue('input_registry_out_sheet').trim()],
                    ]);
                    await i.editReply({ content: '✅ บันทึกตั้งค่าชีต PD แล้ว' });
                    break;
                }
            }
        } catch (error) {
            logger.error('RECOUNT', `Error: ${error}`);
            try { await i.editReply?.({ content: '❌ เกิดข้อผิดพลาด' }); } catch {}
        }
    });
}

async function safeDefer(i: any): Promise<boolean> {
    try {
        if (i.isButton) await i.deferUpdate().catch(() => {});
        else if (i.isModalSubmit) await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
    } catch { return false; }
}

async function refreshPanel(i: any): Promise<void> {
    try {
        if (i?.message) {
            await i.message.edit({ embeds: [createPanelEmbed()], components: buildPanelComponents() });
        }
    } catch {}
}

async function runResendMissed(client: Client, i: any, abortSignal: AbortSignal): Promise<{ sent: number; failed: number; message: string }> {
    const logChannelId = configService.getLogCaseChannelId();
    const guild = i.guild;
    if (!logChannelId || !guild) return { sent: 0, failed: 0, message: '❌ ไม่พบห้อง Log' };

    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel || !logChannel.isTextBased()) return { sent: 0, failed: 0, message: '❌ ไม่พบห้อง Log' };

    let scanned = 0, bypdSent = 0, proctorSent = 0, failed = 0, bypdAlready = 0, proctorAlready = 0;
    let lastId: string | undefined;

    while (true) {
        if (abortSignal.aborted) break;
        const messages = await logChannel.messages.fetch({ limit: 100, before: lastId });
        if (messages.size === 0) break;

        const batch = [...messages.values()].reverse();
        for (const msg of batch) {
            const content = msg.content || msg.embeds?.[0]?.description || '';
            const isBypd = content.toUpperCase().includes('BYPD');
            const isProctor = msg.embeds?.[0]?.title?.includes('📋 บันทึกการคุมสอบ Proctor') ?? false;
            const hasCheck = msg.reactions.cache.some((r: any) => r.emoji.name === '✅');

            if (isBypd && !hasCheck) {
                try { await processBypd(msg); bypdSent++; } catch { failed++; }
                await new Promise(r => setTimeout(r, 500));
            } else if (isBypd && hasCheck) { bypdAlready++; }

            if (isProctor && !hasCheck) {
                try {
                    const targetId = configService.getProctorChannelId();
                    if (targetId) {
                        const target = guild.channels.cache.get(targetId);
                        if (target?.isTextBased()) {
                            await target.send({ embeds: [msg.embeds[0]] });
                            await msg.react('✅').catch(() => {});
                            proctorSent++;
                        }
                    }
                } catch { failed++; }
                await new Promise(r => setTimeout(r, 500));
            } else if (isProctor && hasCheck) { proctorAlready++; }
        }

        scanned += batch.length;
        lastId = messages.last()?.id;
    }

    const stopped = abortSignal.aborted;
    const msg = stopped
        ? `⏹️ หยุดส่งย้อนหลังแล้ว\n📊 สแกน: ${scanned} | BYPD: ${bypdSent} | Proctor: ${proctorSent} | ❌ ${failed}\n📊 เคยส่งแล้ว: BYPD ${bypdAlready} | Proctor ${proctorAlready}`
        : `✅ ส่งย้อนหลังเสร็จสิ้น\n📊 สแกน: ${scanned} | BYPD: ${bypdSent} | Proctor: ${proctorSent} | ❌ ${failed}\n📊 เคยส่งแล้ว: BYPD ${bypdAlready} | Proctor ${proctorAlready}`;

    return { sent: bypdSent + proctorSent, failed, message: msg };
}
