import { Client, Events, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { extractUserId, colToIndex, sleep } from '../../services/utils';
import { stripPrefix } from '../../services/member.service';
import { logger } from '../../core/logger';

const CONFIG = { THIRTY_DAY_ROLE_ID: '1509659434681635096', EXEMPT_ROLES: ['1507105753461424198', '1507570062649983027', '1507107833890738347'], DAY_THRESHOLD: 30, DAY_COLUMN: 'L', REASON_COLUMN: 'N' };

async function moveToOutDC(sid: string, sn: string, osn: string, namePdRowIndex: number, row: string[], reason: string) {
    // หาแถวว่างใน OutDC
    const out = await sheetService.getValues(sid, `${osn}!B:B`, 0);
    let nr = out.length + 1; if (nr < 3) nr = 3;
    // เขียนข้อมูลไป OutDC
    const md = new Array(12).fill(''); for (let c = 0; c < 12; c++) { const si = c + 1; if (row[si] !== undefined) md[c] = String(row[si]).trim(); }
    await sheetService.updateValues(sid, `${osn}!B${nr}:M${nr}`, [md]);
    await sheetService.updateValues(sid, `${osn}!${CONFIG.REASON_COLUMN}${nr}`, [[reason]]);
    // ลบข้อมูลใน NamePD แถวที่ถูกต้อง (namePdRowIndex = idx + 1)
    for (const col of ['B', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'O', 'P', 'Q', 'R', 'S', 'T', 'U']) await sheetService.clearValues(sid, `${sn}!${col}${namePdRowIndex}`).catch(() => {});
}

export function setupThirtyDayFeature(client: Client): void {
    client.once(Events.ClientReady, async () => {
        try { await client.application?.commands.create(new SlashCommandBuilder().setName('30day').setDescription('⏳ ตรวจสอบและจัดการสมาชิกครบ 30 วัน').setDefaultMemberPermissions(0)); logger.info('30วัน', 'ลงทะเบียน /30day สำเร็จ'); } catch (e) { logger.error('30วัน', `ลงทะเบียนล้มเหลว: ${e}`); }
    });

    client.on(Events.InteractionCreate, async (i: any) => {
        if (!i.isChatInputCommand || i.commandName !== '30day') return;
        if (!i.memberPermissions?.has('Administrator')) return i.reply({ content: '❌ เฉพาะผู้ดูแลระบบ', flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const reg = configService.getRegistryConfig();
            if (!reg.spreadsheetId || !reg.sheetName) return i.editReply({ content: '❌ ยังไม่ได้ตั้งค่า Registry Config' });
            const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!A:M`, 0);
            const di = colToIndex(CONFIG.DAY_COLUMN);
            const done: string[] = [], skip: string[] = [];
            for (let idx = 2; idx < rows.length; idx++) {
                const row = rows[idx]; if (!row) continue;
                const dv = parseInt(row[di]) || 0; if (dv <= CONFIG.DAY_THRESHOLD) continue;
                const uid = extractUserId(row[4] || ''); if (!uid) { skip.push(`แถว ${idx + 1}: ไม่พบ Discord ID`); continue; }
                const mem = await i.guild?.members.fetch(uid).catch(() => null);
                if (!mem) { await moveToOutDC(reg.spreadsheetId, reg.sheetName, reg.outSheetName, idx + 1, row, '30Day (ไม่พบใน DC)'); done.push(`แถว ${idx + 1} (${uid}): ย้ายออก`); continue; }
                if (CONFIG.EXEMPT_ROLES.some((r: string) => mem.roles.cache.has(r))) { skip.push(`${mem.user.tag}: มี EXEMPT`); continue; }
                await moveToOutDC(reg.spreadsheetId, reg.sheetName, reg.outSheetName, idx + 1, row, '30Day');
                const toRemove = mem.roles.cache.filter((r: any) => r.id !== mem.guild.id && !CONFIG.EXEMPT_ROLES.includes(r.id) && r.id !== CONFIG.THIRTY_DAY_ROLE_ID);
                if (toRemove.size > 0) await mem.roles.remove(toRemove).catch(() => {});
                await mem.roles.add(CONFIG.THIRTY_DAY_ROLE_ID).catch(() => {});
                const cn = stripPrefix(mem.nickname || mem.displayName);
                if (cn && cn !== mem.nickname) await mem.setNickname(cn).catch(() => {});
                done.push(`${mem.user.tag}: จัดการสำเร็จ`); await sleep(500);
            }
            await i.editReply({ content: `⏳ **ผลการตรวจสอบครบ 30 วัน**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ **จัดการแล้ว ${done.length} คน:**\n${done.map(p => `  • ${p}`).join('\n')}\n\n⏭️ **ข้าม ${skip.length} คน:**\n${skip.map(s => `  • ${s}`).join('\n')}` });
        } catch (e: any) { logger.error('30วัน', `ผิดพลาด: ${e}`); await i.editReply({ content: `❌ เกิดข้อผิดพลาด: ${e.message}` }); }
    });
}