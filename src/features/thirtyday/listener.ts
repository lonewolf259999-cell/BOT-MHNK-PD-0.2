import { Client, Events, MessageFlags, ChatInputCommandInteraction } from 'discord.js';
import { configService } from '../../core/config.service';
import { extractUserId, sleep, silentCatch } from '../../services/utils';
import { stripPrefix } from '../../services/member.service';
import { moveToOutDC } from '../welcome/welcome.service';
import { sheetService } from '../../core/sheet.service';
import { logger } from '../../core/logger';

export function setupThirtyDayFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i) => {
        if (!i.isChatInputCommand() || i.commandName !== '30day') return;
        const cmd = i as ChatInputCommandInteraction<'cached'>;
        if (!cmd.memberPermissions?.has('Administrator')) {
            await cmd.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
            return;
        }
        await cmd.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const reg = configService.getRegistryConfig();
            if (!reg.spreadsheetId || !reg.sheetName) {
                await cmd.editReply({ content: '❌ ยังไม่ได้ตั้งค่า Registry Config' });
                return;
            }

            // ✅ อ่านค่าจาก configService (ซึ่งอ่านจาก Google Sheet)
            const exemptRoles = configService.getExemptRoles();
            const thirtyDayRoleId = configService.getThirtyDayRoleId();
            const dayThreshold = configService.getDayThreshold();

            const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!A:M`, 0);
            const dayIdx = 11; // Column L = index 11
            const done: string[] = [];
            const skip: string[] = [];
            for (let idx = 2; idx < rows.length; idx++) {
                const row = rows[idx];
                if (!row) continue;
                const dv = parseInt(row[dayIdx]) || 0;
                if (dv <= dayThreshold) continue;
                const uid = extractUserId(row[4] || '');
                if (!uid) {
                    skip.push(`แถว ${idx + 1}: ไม่พบ Discord ID`);
                    continue;
                }
                const mem = await cmd.guild?.members.fetch(uid).catch(() => null);
                if (!mem) {
                    await moveToOutDC(uid, '30Day (ไม่เข้า Discord)');
                    done.push(`แถว ${idx + 1} (${uid}): ย้ายออก`);
                    continue;
                }
                if (exemptRoles.some((r: string) => mem.roles.cache.has(r))) {
                    skip.push(`${mem.user.tag}: มี EXEMPT`);
                    continue;
                }
                await moveToOutDC(uid, '30Day');
                const toRemove = mem.roles.cache.filter((r) => r.id !== mem.guild.id && !exemptRoles.includes(r.id) && r.id !== thirtyDayRoleId);
                if (toRemove.size > 0) await mem.roles.remove(toRemove).catch(silentCatch('30Day'));
                await mem.roles.add(thirtyDayRoleId).catch(silentCatch('30Day'));
                const cn = stripPrefix(mem.nickname || mem.displayName);
                if (cn && cn !== mem.nickname) await mem.setNickname(cn).catch(silentCatch('30Day'));
                done.push(`${mem.user.tag}: จัดการสำเร็จ`);
                await sleep(500);
            }
            await cmd.editReply({
                content: `⏳ **ผลการตรวจสอบครบ 30 วัน**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ **จัดการแล้ว ${done.length} คน:**\n${done.map(p => `  • ${p}`).join('\n')}\n\n⏭️ **ข้าม ${skip.length} คน:**\n${skip.map(s => `  • ${s}`).join('\n')}`,
            });
        } catch (e: unknown) {
            logger.error('30วัน', `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
            await cmd.editReply({ content: `❌ เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}` });
        }
    });
}