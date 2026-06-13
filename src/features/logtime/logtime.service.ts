import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName } from '../../services/utils';
import { logger } from '../../core/logger';

interface LogtimeInfo { name: string; date: string; time: string; id?: string; }
const NEW_ROW_MIN = 3;

function icNameFromD(cell: string): string {
    if (!cell) return '';
    const b = String(cell).match(/\]\s*(.+)$/);
    return b ? normalizeName(b[1]) : normalizeName(cell);
}
function matchForward(log: string, dCell: string): boolean {
    if (!log || !dCell) return false;
    const f = normalizeName(dCell), ic = icNameFromD(dCell);
    return f.includes(log) || ic.includes(log);
}

/**
 * Find the target row matching the logtime entry.
 *
 * Logic:
 *   1. Match by Steam ID (M or Y column) — exact match → use that row.
 *   2. Match by name (D column) — check conflict with M/Y before claiming.
 *       - M has value & not matching Steam ID → skip (different person with same name).
 *       - Y has value & not matching Steam ID → skip.
 *       - M empty & Y empty → use that row (fresh person, first time logging in).
 *       - M empty but Y matches Steam ID → use that row (person already registered).
 *   3. Match by X+Y (registered name + Steam ID) — both match → use that row (re-login by reg name).
 *   4. Create new row — write X, Y, J:K.
 */
function findRow(rows: string[][], name: string, steamId?: string): { row: number; isNew: boolean } {
    const n = normalizeName(name);
    const s = steamId ? normalizeName(steamId) : undefined;

    // Check if row has a Steam ID that belongs to someone else
    function hasSteamConflict(row: string[]): boolean {
        if (!s) return false; // no steamId to compare → assume no conflict
        const mSteam = row[9] ? normalizeName(row[9]) : ''; // M column
        const ySteam = row[21] ? normalizeName(row[21]) : ''; // Y column
        if (mSteam && mSteam !== s) return true;
        if (ySteam && ySteam !== s) return true;
        return false;
    }

    // STEP 1: Match by Steam ID (M → old rows, Y → new rows)
    if (s) {
        for (let idx = 2; idx < rows.length; idx++) {
            const mSteam = rows[idx]?.[9] ? normalizeName(rows[idx][9]) : '';
            const ySteam = rows[idx]?.[21] ? normalizeName(rows[idx][21]) : '';
            if (mSteam === s || ySteam === s)
                return { row: idx + 1, isNew: false };
        }
    }

    // STEP 2: Match by name in D (exact forward match)
    for (let idx = 2; idx < rows.length; idx++) {
        if (rows[idx]?.[0] && matchForward(n, rows[idx][0])) {
            if (hasSteamConflict(rows[idx])) continue; // same name, different Steam ID → skip
            return { row: idx + 1, isNew: false };
        }
    }

    // STEP 3: Match by X+Y (registered name + Steam ID together)
    for (let idx = NEW_ROW_MIN - 1; idx < rows.length; idx++) {
        const xName = rows[idx]?.[20] ? normalizeName(rows[idx][20]) : '';
        const ySteam = rows[idx]?.[21] ? normalizeName(rows[idx][21]) : '';
        if (!xName) continue;
        const nameMatch = xName.includes(n) || n.includes(xName);
        const steamMatch = s && ySteam && ySteam === s;
        if (nameMatch && steamMatch) return { row: idx + 1, isNew: false };
    }

    // STEP 4: Create new entry — find first empty row in X
    for (let r = NEW_ROW_MIN; r <= rows.length; r++) {
        if (!rows[r - 1]?.[20] || !String(rows[r - 1][20]).trim())
            return { row: r, isNew: true };
    }
    return { row: rows.length + 1, isNew: true };
}

export async function processLogtime(info: LogtimeInfo): Promise<string> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return '❌ Config ไม่พร้อม';
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!D:Y`, 0);
    const { row, isNew } = findRow(rows, info.name, info.id);
    const updates: { range: string; values: string[][] }[] = [];

    if (isNew) {
        // New person: register name + Steam ID in X/Y, AND log J:K for first duty
        updates.push({ range: `${reg.sheetName}!X${row}`, values: [[info.name]] });
        if (info.id) updates.push({ range: `${reg.sheetName}!Y${row}`, values: [[info.id]] });
        updates.push({ range: `${reg.sheetName}!J${row}:K${row}`, values: [[info.date, info.time]] });
        if (info.id) updates.push({ range: `${reg.sheetName}!M${row}`, values: [[info.id]] });
    } else {
        // Existing person: update duty time
        updates.push({ range: `${reg.sheetName}!J${row}:K${row}`, values: [[info.date, info.time]] });
        // Write Steam ID to M only if M is currently empty
        if (info.id && (!rows[row - 1]?.[9] || !String(rows[row - 1][9]).trim()))
            updates.push({ range: `${reg.sheetName}!M${row}`, values: [[info.id]] });
    }

    if (updates.length > 0) await sheetService.batchUpdateValues(reg.spreadsheetId, updates);
    const note = isNew ? `ใหม่ที่ X${row}` : `แถว ${row}`;
    logger.info('ลงเวลา', `${info.name} -> ${note}`);
    return `${info.name} -> ${note}`;
}
