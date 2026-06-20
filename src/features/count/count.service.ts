import { Client, CommandInteraction, ButtonInteraction } from 'discord.js';
import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName, replyAndDelete, silentCatch } from '../../services/utils';
import { logger } from '../../core/logger';
import { locks } from '../../core/lock.service';
import type { TagInfo } from '../../types/discord';
import { CONSTANTS } from '../../types/discord';

/*
 * IMPORTANT: Actual Sheet Structure
 *   Row 1: (empty)
 *   Row 2: (empty)
 *   Row 3: Header row (A="ชื่อDC", B="User ID", C-G=count columns)
 *   Row 4+: Data (A=display name, B=Discord User ID, C=Take2, D=คดีปกติ, E=รถยอด, F=คุมสอบ, G=อุ้มเอ๋อ)
 * 
 * Column indices: A=0, B=1, C=2, D=3, E=4, F=5, G=6
 * Data starts at row index 3 (0-based)
 */

/**
 * Find row index by exact Discord User ID match in Column B (index 1).
 * Only searches data rows (index 3+).
 */
function findRowById(rows: string[][], userId: string): number {
    for (let i = CONSTANTS.COUNT_DATA_START; i < rows.length; i++) {
        if (rows[i]?.length > 1 && rows[i][1] === userId) return i;
    }
    return -1;
}

/**
 * Backward-compatible fallback: find row by name/nickname match in Column A (index 0).
 * For existing rows that may not have User ID in Column B yet.
 * Only searches data rows (index 3+).
 */
function findRowByName(rows: string[][], tag: TagInfo): number {
    const n = normalizeName(tag.nickname);
    const u = normalizeName(tag.username);
    for (let i = CONSTANTS.COUNT_DATA_START; i < rows.length; i++) {
        const nameCell = rows[i]?.[0]; // Column A = display name
        const idCell = rows[i]?.[1];   // Column B = User ID (may be empty in old data)
        if (nameCell) {
            const nameLower = normalizeName(nameCell);
            // Match by display name OR by username in Column B
            if (nameLower.includes(n) || nameLower.includes(u) || normalizeName(idCell || '') === u) {
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
 * Priority: 1) Exact User ID match in Column B  2) Name match in Column A  3) Create new row
 * When found by name, automatically sets User ID in Column B.
 * 
 * Sheet format: [A=displayName, B=UserID, C=Take2, D=คดีปกติ, E=รถยอด, F=คุมสอบ, G=อุ้มเอ๋อ]
 */
function ensureUserRow(rows: string[][], tag: TagInfo): number {
    // Priority 1: Exact User ID match in Column B
    let idx = findRowById(rows, tag.id);
    if (idx !== -1) return idx;

    // Priority 2: Backward-compatible name match in Column A
    idx = findRowByName(rows, tag);
    if (idx !== -1) {
        // Migrate: set User ID in Column B for future exact lookups
        rows[idx][1] = tag.id;
        return idx;
    }

    // Priority 3: Create new row [displayName, UserID, 0,0,0,0,0]
    rows.push([tag.nickname || tag.username, tag.id, '0', '0', '0', '0', '0']);
    return rows.length - 1;
}

export async function processCountBatch(
    tags: TagInfo[],
    channelId: string,
    isDelete: boolean
): Promise<void> {
    return locks.count.run(async () => {
        const cfg = configService.getCountConfig();
        if (!cfg.SPREADSHEET_ID || !cfg.SHEET_NAME) return;

        // Map channel to column index (C=2, D=3, E=4, F=5, G=6)
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

        // If sheet is too short, ensure it has at least DATA_START_ROW rows
        while (rows.length < CONSTANTS.COUNT_DATA_START) {
            rows.push([]);
        }

        // Ensure header row exists at row index 3 (0-based)
        if (rows[CONSTANTS.COUNT_DATA_START - 1]?.length < 7 || !rows[CONSTANTS.COUNT_DATA_START - 1]?.[0]) {
            rows[CONSTANTS.COUNT_DATA_START - 1] = CONSTANTS.COUNT_HEADER;
        }

        for (const p of tags) {
            // Find or create row by exact User ID in Column B
            const rowIdx = ensureUserRow(rows, p);

            // Update count for the specific column
            const currentVal = parseInt(rows[rowIdx][colIdx] || '0') || 0;
            rows[rowIdx][colIdx] = Math.max(0, currentVal + (isDelete ? -1 : 1)).toString();
        }

        // Write updated data back to sheet (start from A1 to preserve empty rows 1-2)
        await sheetService.updateValues(
            cfg.SPREADSHEET_ID,
            `${cfg.SHEET_NAME}!A1`,
            rows
        );
    });
}

/**
 * Shared interaction type for manual recount — only needs deferReply, editReply, guild
 */
type RecountInteraction = CommandInteraction<'cached'> | ButtonInteraction<'cached'>;

export async function manualRecount(client: Client, interaction: RecountInteraction): Promise<void> {
    return locks.count.run(async () => {
        const cfg = configService.getCountConfig();
        if (!cfg.SPREADSHEET_ID || !cfg.SHEET_NAME) {
            try {
                await interaction.deferReply({ flags: 64 }).catch(silentCatch('Count'));
                await interaction.editReply({ content: '❌ ยังไม่ได้ตั้งค่า' });
            } catch { /* ignore */ }
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

        // Ensure sheet has minimum structure
        while (rows.length < CONSTANTS.COUNT_DATA_START) {
            rows.push([]);
        }

        // Ensure header row exists at row index 3 (0-based)
        if (rows[CONSTANTS.COUNT_DATA_START - 1]?.length < 7 || !rows[CONSTANTS.COUNT_DATA_START - 1]?.[0]) {
            rows[CONSTANTS.COUNT_DATA_START - 1] = CONSTANTS.COUNT_HEADER;
        }

        // Reset all count columns (C-G, indices 2-6) for existing data rows only (index 3+)
        for (let i = CONSTANTS.COUNT_DATA_START; i < rows.length; i++) {
            if (rows[i]) {
                // Ensure row has enough columns (at least 7: A-G)
                while (rows[i].length < 7) rows[i].push('0');
                // Reset count columns C-G to 0
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
        const userCache = new Map<string, TagInfo>();
        let totalMessages = 0;

        for (const ch of channels) {
            if (!ch.id) continue;

            const channel = client.channels.cache.get(ch.id);
            if (!channel || !channel.isTextBased()) continue;

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

                        // Find or create row by exact User ID in Column B
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

        // Write all data back to sheet (start from A1 to preserve empty rows 1-2)
        await sheetService.updateValues(
            cfg.SPREADSHEET_ID,
            `${cfg.SHEET_NAME}!A1`,
            rows
        );

        await replyAndDelete(interaction, `✅ นับข้อความเก่าเสร็จ: ${totalMessages} ข้อความ`);
        logger.info('นับเคส', `นับข้อความเก่าเสร็จ: ${totalMessages} ข้อความ`);
    });
}