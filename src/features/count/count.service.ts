import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName } from '../../services/utils';
import { logger } from '../../core/logger';

export async function processCountBatch(tags: { id: string; nickname: string; username: string }[], channelId: string, isDelete: boolean): Promise<void> {
    const cfg = configService.getCountConfig();
    if (!cfg.SPREADSHEET_ID || !cfg.SHEET_NAME) return;
    const chMap: Record<string, number> = { [cfg.CHANNELS.CHANNEL_1]: 2, [cfg.CHANNELS.CHANNEL_2]: 3, [cfg.CHANNELS.CHANNEL_3]: 4, [cfg.CHANNELS.CHANNEL_4]: 5, [cfg.CHANNELS.CHANNEL_5]: 6 };
    const ci = chMap[channelId]; if (ci === undefined) return;
    const rows = await sheetService.getValues(cfg.SPREADSHEET_ID, `${cfg.SHEET_NAME}!A:G`, 0);
    for (const p of tags) {
        const n = normalizeName(p.nickname), u = normalizeName(p.username);
        let found = false;
        for (let i = 1; i < rows.length; i++) {
            const c = rows[i]?.[0];
            if (c && (normalizeName(c).includes(n) || normalizeName(c).includes(u) || normalizeName(rows[i]?.[1] || '') === u)) {
                const ov = parseInt(rows[i][ci] || '0') || 0; rows[i][ci] = Math.max(0, ov + (isDelete ? -1 : 1)).toString(); found = true; break;
            }
        }
        if (!found && !isDelete) { const nr = [p.nickname, p.username, '0', '0', '0', '0', '0']; nr[ci] = '1'; rows.push(nr); }
    }
    await sheetService.updateValues(cfg.SPREADSHEET_ID, `${cfg.SHEET_NAME}!A1`, rows);
}

export async function manualRecount(client: any, interaction: any): Promise<void> {
    const cfg = configService.getCountConfig();
    if (!cfg.SPREADSHEET_ID || !cfg.SHEET_NAME) { await interaction.editReply({ content: '❌ ยังไม่ได้ตั้งค่า' }); return; }
    await sheetService.clearValues(cfg.SPREADSHEET_ID, `${cfg.SHEET_NAME}!C4:G`);
    let rows = await sheetService.getValues(cfg.SPREADSHEET_ID, `${cfg.SHEET_NAME}!A:G`, 0) || [];
    for (let i = 3; i < rows.length; i++) { if (rows[i]) for (let c = 2; c <= 6; c++) if (rows[i].length > c) rows[i][c] = ''; }

    const channels = [{ id: cfg.CHANNELS.CHANNEL_1, col: 2 }, { id: cfg.CHANNELS.CHANNEL_2, col: 3 }, { id: cfg.CHANNELS.CHANNEL_3, col: 4 }, { id: cfg.CHANNELS.CHANNEL_4, col: 5 }, { id: cfg.CHANNELS.CHANNEL_5, col: 6 }];
    const cache = new Map<string, { id: string; nickname: string; username: string }>();
    let total = 0;

    for (const ch of channels) {
        if (!ch.id) continue;
        const channel = client.channels.cache.get(ch.id); if (!channel) continue;
        let lastId: string | undefined, more = true;
        while (more) {
            const msgs = await channel.messages.fetch({ limit: 100, before: lastId }); if (msgs.size === 0) break;
            for (const msg of msgs.values()) {
                const mentions = msg.content.match(/<@!?(\d+)>/g) || [];
                const ids = [...new Set(mentions.map((m: string) => m.match(/\d+/)?.[0]).filter(Boolean))];
                for (const uid of ids as string[]) {
                    if (!cache.has(uid)) {
                        try { const user = await client.users.fetch(uid); const mem = await interaction.guild.members.fetch(uid).catch(() => null); cache.set(uid, { id: uid, nickname: mem ? (mem.nickname || user.displayName) : user.username, username: user.username }); } catch { continue; }
                    }
                    const p = cache.get(uid); if (!p) continue;
                    const sn = normalizeName(p.nickname), du = normalizeName(p.username);
                    let ri = rows.findIndex((r: string[], idx: number) => idx >= 3 && r[0] && (normalizeName(r[0]).includes(sn) || normalizeName(r[0]).includes(du) || normalizeName(r[1] || '') === du));
                    if (ri !== -1) { const v = parseInt(rows[ri][ch.col] || '0') || 0; rows[ri][ch.col] = (v + 1).toString(); }
                    else { const nr = [p.nickname, p.username, '', '', '', '', '']; nr[ch.col] = '1'; rows.push(nr); }
                }
            }
            total += msgs.size; lastId = msgs.last()?.id; if (msgs.size < 100) more = false;
        }
    }
    await sheetService.updateValues(cfg.SPREADSHEET_ID, `${cfg.SHEET_NAME}!A1`, rows);
    logger.info('นับเคส', `นับข้อความเก่าเสร็จ: ${total} ข้อความ`);
}