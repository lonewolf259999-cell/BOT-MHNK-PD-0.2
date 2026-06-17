import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName, replyAndDelete, silentCatch } from '../../services/utils';
import { logger } from '../../core/logger';
import { locks } from '../../core/lock.service';

/**
 * Find row index by exact Discord User ID match in Column A.
 */
function findRowById(rows: string[][], userId: string): number {
    for (let i = 1; i < rows.length; i++) {
        if (rows[i]?.[0] === userId) return i;
    }
    return -1;
}

/**
 * Backward-compatible fallback: find row by name/nickname match.
 * This handles existing sheets that still have names in Column A instead of User IDs.
 * Uses the same `.includes()` logic as the original code for compatibility.
 */
function findRowByName(rows: string[][], tag: { id: string; nickname: string; username: string }): number {
    const n = normalizeName(tag.nickname);
    const u = normalizeName(tag.username);
    for (let i = 1; i < rows.length; i++) {
        const cell = rows[i]?.[0];
        if (cell) {
            const cellLower = normalizeName(cell);
            if (cellLower.includes(n) || cellLower.includes(u) || normalizeName(rows[i]?.[1] || '') === u) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Ensure a row exists for the user, creating one if not found.
 * Returns the row index.
 * 
 * Priority: 1) Exact User ID match 2) Backward-compatible name match 3) Create new row
 * When found by name, automatically migrates the row to use User ID in Column A.
 */
function ensureUserRow(rows: string[][], tag: { id: string; nickname: string; username: string }): number {
    // Priority 1: Exact User ID match (new format)
    let idx = findRowById(rows, tag.id);
    if (idx !== -1) return idx;

    // Priority 2: Backward-compatible name match (old format)
    idx = findRowByName(rows, tag);
    if (idx !== -1) {
        // Migrate: replace name with User ID so all future lookups use exact ID
        rows[idx][0] = tag.id;
        return idx;
    }

    // Priority 3: Create new row with User ID as key
    rows.push([tag.id, tag.nickname || tag.username, '0', '0', '0', '0', '0']);
    return rows.length - 1;
}

export async function processCountBatch(
    tags: { id: string; nickname: string; username: string }[],
    channelId: string,
    isDelete: boolean
): Promise<void> {
    return locks.count.run(async () => {
        const cfg = configService.getCountConfig();
        if (!cfg.SPREADSHEET_ID || !cfg.SHEET_NAME) return;

        // Map channel to column index
        const chMap: Record<string, number> = {
            [cfg.CHANNELS.CHANNEL_1]: 2,
            [cfg.CHANNELS.CHANNEL_2]: 3,
            [cfg.CHANNELS.CHANNEL_3]: 4,
            [cfg.CHANNELS.CHANNEL_4]: 5,
            [cfg.CHANNELS.CHANNEL_5]: 6,
        };
        const colIdx = chMap[channelId];
        if (colIdx === undefined) return;

        // Read fresh data from sheet (TTL=0 = no cache)
        const rows = await sheetService.getValues(
            cfg.SPREADSHEET_ID,
            `${cfg.SHEET_NAME}!A:G`,
            0
        );

        // If sheet is empty, initialize header row
        if (rows.length === 0) {
            rows.push(['User ID', 'ชื่อเล่น', 'Take2', 'คดีปกติ', 'รถยอด', 'คุมสอบ', 'อุ้มเอ๋อ']);
        }

        for (const p of tags) {
            // Find or create row by exact User ID match
            const rowIdx = ensureUserRow(rows, p);

            // Update count for the specific column
            const currentVal = parseInt(rows[rowIdx][colIdx] || '0') || 0;
            rows[rowIdx][colIdx] = Math.max(0, currentVal + (isDelete ? -1 : 1)).toString();
        }

        // Write updated data back to sheet
        await sheetService.updateValues(
            cfg.SPREADSHEET_ID,
            `${cfg.SHEET_NAME}!A1`,
            rows
        );
    });
}

export async function manualRecount(client: any, interaction: any): Promise<void> {
    return locks.count.run(async () => {
        const cfg = configService.getCountConfig();
        if (!cfg.SPREADSHEET_ID || !cfg.SHEET_NAME) {
            try {
                await interaction.deferReply({ flags: 64 }).catch(silentCatch('Count'));
                await interaction.editReply({ content: '❌ ยังไม่ได้ตั้งค่า' });
            } catch {}
            return;
        }

        try {
            await interaction.deferReply({ flags: 64 }).catch(silentCatch('Count'));
        } catch { return; }

        // Read current sheet data
        const rows = await sheetService.getValues(
            cfg.SPREADSHEET_ID,
            `${cfg.SHEET_NAME}!A:G`,
            0
        );

        // Reset all count columns (C-G, indices 2-6) for existing data rows
        for (let i = 1; i < rows.length; i++) {
            if (rows[i]) {
                // Ensure row has enough columns
                while (rows[i].length < 7) rows[i].push('0');
                // Reset count columns to 0
                for (let c = 2; c <= 6; c++) {
                    rows[i][c] = '0';
                }
            }
        }

        const channels = [
            { id: cfg.CHANNELS.CHANNEL_1, col: 2 },
            { id: cfg.CHANNELS.CHANNEL_2, col: 3 },
            { id: cfg.CHANNELS.CHANNEL_3, col: 4 },
            { id: cfg.CHANNELS.CHANNEL_4, col: 5 },
            { id: cfg.CHANNELS.CHANNEL_5, col: 6 },
        ];

        // Cache fetched Discord users to avoid repeated API calls
        const userCache = new Map<string, { id: string; nickname: string; username: string }>();
        let totalMessages = 0;

        for (const ch of channels) {
            if (!ch.id) continue;

            const channel = client.channels.cache.get(ch.id);
            if (!channel) continue;

            let lastId: string | undefined;
            let hasMore = true;

            while (hasMore) {
                const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
                if (msgs.size === 0) break;

                for (const msg of msgs.values()) {
                    // Extract all unique mentioned user IDs
                    const mentions = msg.content.match(/<@!?(\d+)>/g) || [];
                    const uniqueIds = [...new Set(
                        mentions
                            .map((m: string) => m.match(/\d+/)?.[0])
                            .filter(Boolean)
                    )] as string[];

                    for (const uid of uniqueIds) {
                        // Fetch user info if not cached
                        if (!userCache.has(uid)) {
                            try {
                                const user = await client.users.fetch(uid);
                                const member = await interaction.guild.members.fetch(uid).catch(() => null);
                                const nickname = member
                                    ? (member.nickname || member.displayName || user.username)
                                    : user.username;
                                userCache.set(uid, {
                                    id: uid,
                                    nickname,
                                    username: user.username,
                                });
                            } catch {
                                continue;
                            }
                        }

                        const person = userCache.get(uid);
                        if (!person) continue;

                        // Find or create row by exact User ID
                        const rowIdx = ensureUserRow(rows, person);

                        // Increment count for this channel
                        const currentVal = parseInt(rows[rowIdx][ch.col] || '0') || 0;
                        rows[rowIdx][ch.col] = (currentVal + 1).toString();
                    }
                }

                totalMessages += msgs.size;
                lastId = msgs.last()?.id;
                if (msgs.size < 100) hasMore = false;
            }
        }

        // Write all data back to sheet
        await sheetService.updateValues(
            cfg.SPREADSHEET_ID,
            `${cfg.SHEET_NAME}!A1`,
            rows
        );

        await replyAndDelete(interaction, `✅ นับข้อความเก่าเสร็จ: ${totalMessages} ข้อความ`);
        logger.info('นับเคส', `นับข้อความเก่าเสร็จ: ${totalMessages} ข้อความ`);
    });
}