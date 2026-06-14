import { Client, Events, MessageFlags } from 'discord.js';
import { configService } from '../../core/config.service';
import { manualRecount } from '../count/count.service';
import { createPanelEmbed, buildPanelComponents } from './panel.service';
import { replyAndDelete, silentCatch } from '../../services/utils';
import { buildCountModal, buildWelcomeModal, buildBypdModal, buildRegistryModal } from './modals';
import { logger } from '../../core/logger';
import { resendStates } from './resend.state';
import { processBypd } from '../bypd/bypd.service';

const PANEL_IDS = new Set([
    'btn_recount_manual', 'btn_cfg_count', 'btn_cfg_welcome', 'btn_cfg_bypd', 'btn_cfg_registry',
    'btn_refresh_config', 'btn_resend_bypd',
    'modal_cfg_count', 'modal_cfg_welcome', 'modal_cfg_bypd', 'modal_cfg_registry',
]);

const MODAL_BUTTONS = ['btn_cfg_count', 'btn_cfg_welcome', 'btn_cfg_bypd', 'btn_cfg_registry'];

export function setupRecountFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i: any) => {
        // --- /recount command ---
        if (i.isChatInputCommand && i.commandName === 'recount') {
            if (!i.memberPermissions?.has('Administrator')) return i.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            await i.channel.send({ embeds: [createPanelEmbed()], components: buildPanelComponents() });
            return replyAndDelete(i, '✅ วางแผงควบคุมในห้องนี้แล้ว');
        }

        // ------------------------------------------
        // BUTTON HANDLING
        // ------------------------------------------
        if (i.isButton && PANEL_IDS.has(i.customId)) {
            if (!i.memberPermissions?.has('Administrator')) return i.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });

            // Modal buttons → showModal ทันที (ห้าม defer)
            if (MODAL_BUTTONS.includes(i.customId)) {
                const modals: Record<string, any> = {
                    'btn_cfg_count': buildCountModal(),
                    'btn_cfg_welcome': buildWelcomeModal(),
                    'btn_cfg_bypd': buildBypdModal(),
                    'btn_cfg_registry': buildRegistryModal(),
                };
                return i.showModal(modals[i.customId]).catch(silentCatch('Recount'));
            }

            // ⭐ เริ่มนับข้อความเก่า → manualRecount จะ defer เองภายใน (เหมือน v0.1)
            if (i.customId === 'btn_recount_manual') {
                return manualRecount(client, i).catch((e: any) => logger.error('RECOUNT', `Manual recount error: ${e}`));
            }

            // 🔄 รีเฟรช config → deferUpdate + แก้ไข embed เดิม (เหมือน v0.1)
            if (i.customId === 'btn_refresh_config') {
                try { await i.deferUpdate(); } catch { return; }
                await configService.reload();
                try { await i.editReply({ embeds: [createPanelEmbed()], components: buildPanelComponents() }); } catch {}
                return;
            }

            // 🔄 ส่งย้อนหลัง BYPD → deferReply (ต้อง reply ใหม่)
            if (i.customId === 'btn_resend_bypd') {
                try { await i.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
                const guildId = i.guildId || 'global';
                const state = resendStates.get(guildId);
                if (state?.isRunning) {
                    resendStates.stop(guildId);
                    await refreshPanel(i);
                    await i.editReply({ content: `⏹️ หยุดทำงานแล้ว\n📊 ส่งสำเร็จ: ${state.totalSent} | ล้มเหลว: ${state.totalFailed}` });
                    return;
                }
                const abort = new AbortController();
                resendStates.set(guildId, { isRunning: true, abortController: abort, totalSent: 0, totalFailed: 0 });
                await refreshPanel(i);
                await i.editReply({ content: '🔄 กำลังส่งย้อนหลัง BYPD...\n⏳ กำลังสแกนห้อง Log...' });
                try {
                    const r = await runResendMissed(client, i, abort.signal);
                    resendStates.set(guildId, { isRunning: false, abortController: null, totalSent: r.sent, totalFailed: r.failed });
                    await refreshPanel(i);
                    await replyAndDelete(i, r.message);
                } catch (err: any) {
                    resendStates.stop(guildId); await refreshPanel(i);
                    await i.editReply({ content: `❌ เกิดข้อผิดพลาด: ${err.message}` });
                }
                return;
            }
        }

        // ------------------------------------------
        // MODAL SUBMIT HANDLING
        // ------------------------------------------
        if (i.isModalSubmit && PANEL_IDS.has(i.customId)) {
            if (!i.memberPermissions?.has('Administrator')) return i.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
            try { await i.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
            try {
                const save = async (keys: [string, string][]) => {
                    await configService.writeConfigKeys(keys);
                    if (i.message) {
                        try { await i.message.edit({ embeds: [createPanelEmbed()], components: buildPanelComponents() }); } catch {}
                    }
                };
                switch (i.customId) {
                    case 'modal_cfg_count': {
                        const raw = i.fields.getTextInputValue('input_all_channels').split(',');
                        await save([
                            ['SPREADSHEET_ID', i.fields.getTextInputValue('input_spreadsheet_id').trim()],
                            ['SHEET_NAME', i.fields.getTextInputValue('input_sheet_name').trim()],
                            ...([1, 2, 3, 4, 5] as const).map((n, idx) => [`CHANNEL_ID_${n}`, (raw[idx] || '').trim()] as [string, string]),
                        ]);
                        await replyAndDelete(i, '✅ บันทึกตั้งค่านับเคสแล้ว');
                        break;
                    }
                    case 'modal_cfg_welcome': await save([['WELCOME_CHANNEL_ID', i.fields.getTextInputValue('input_welcome_channel').trim()], ['LOG_CHANNEL_ID', i.fields.getTextInputValue('input_log_channel').trim()], ['LOGTIME_CHANNEL_ID', i.fields.getTextInputValue('input_logtime_channel').trim()]]); await replyAndDelete(i, '✅ บันทึกตั้งค่าต้อนรับแล้ว'); break;
                    case 'modal_cfg_bypd': await save([['LOGCASE_CHANNEL_ID', i.fields.getTextInputValue('input_logcase_channel').trim()], ['BYPD_SEND_CHANNEL_ID', i.fields.getTextInputValue('input_bypd_send').trim()], ['PROCTOR_CHANNEL_ID', i.fields.getTextInputValue('input_proctor_channel').trim()]]); await replyAndDelete(i, '✅ บันทึกตั้งค่า LogCase + BYPD + Proctor แล้ว'); break;
                    case 'modal_cfg_registry': await save([['REGISTRY_SPREADSHEET_ID', i.fields.getTextInputValue('input_registry_sheet_id').trim()], ['REGISTRY_SHEET_NAME', i.fields.getTextInputValue('input_registry_sheet_name').trim()], ['REGISTRY_OUT_SHEET_NAME', i.fields.getTextInputValue('input_registry_out_sheet').trim()]]); await replyAndDelete(i, '✅ บันทึกตั้งค่าชีต PD แล้ว'); break;
                }
            } catch (e) { logger.error('RECOUNT', `Modal error: ${e}`); try { await i.editReply({ content: '❌ เกิดข้อผิดพลาด' }); } catch {} }
        }
    });
}

async function refreshPanel(i: any): Promise<void> {
    try { if (i?.message) { await i.message.edit({ embeds: [createPanelEmbed()], components: buildPanelComponents() }); } } catch {}
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
            // ตรวจ BYPD แบบละเอียด (content + ทุก embed)
            const hasBypd = (msg.content?.toUpperCase().includes('BYPD')) ||
                msg.embeds?.some((e: any) =>
                    e.title?.toUpperCase().includes('BYPD') ||
                    e.description?.toUpperCase().includes('BYPD') ||
                    e.fields?.some((f: any) => f.name?.toUpperCase().includes('BYPD') || f.value?.toUpperCase().includes('BYPD')) ||
                    e.footer?.text?.toUpperCase().includes('BYPD')
                );
            const isProctor = msg.embeds?.[0]?.title?.includes('📋 บันทึกการคุมสอบ Proctor') ?? false;
            const hasCheck = msg.reactions.cache.some((r: any) => r.emoji.name === '✅');
            if (hasBypd && !hasCheck) { try { await processBypd(msg); bypdSent++; } catch { failed++; } await new Promise(r => setTimeout(r, 500)); } else if (hasBypd && hasCheck) bypdAlready++;
            if (isProctor && !hasCheck) {
                try { const targetId = configService.getProctorChannelId(); if (targetId) { const target = guild.channels.cache.get(targetId); if (target?.isTextBased()) { await target.send({ embeds: [msg.embeds[0]] }); await msg.react('✅').catch(silentCatch('Recount')); proctorSent++; } } } catch { failed++; }
                await new Promise(r => setTimeout(r, 500));
            } else if (isProctor && hasCheck) proctorAlready++;
        }
        scanned += batch.length; lastId = messages.last()?.id;
    }
    return { sent: bypdSent + proctorSent, failed, message: abortSignal.aborted ? `⏹️ หยุดส่งย้อนหลังแล้ว\n📊 สแกน: ${scanned} | BYPD: ${bypdSent} | Proctor: ${proctorSent} | ❌ ${failed}\n📊 เคยส่งแล้ว: BYPD ${bypdAlready} | Proctor ${proctorAlready}` : `✅ ส่งย้อนหลังเสร็จสิ้น\n📊 สแกน: ${scanned} | BYPD: ${bypdSent} | Proctor: ${proctorSent} | ❌ ${failed}\n📊 เคยส่งแล้ว: BYPD ${bypdAlready} | Proctor ${proctorAlready}` };
}