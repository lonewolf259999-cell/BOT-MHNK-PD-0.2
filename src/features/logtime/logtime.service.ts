import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName } from '../../services/utils';
import { logger } from '../../core/logger';

interface LogtimeInfo { name: string; date: string; time: string; id?: string; }
const NEW_ROW_MIN = 3;

type FindResult =
  | { action: 'update_time'; row: number }
  | { action: 'update_time_steam'; row: number }
  | { action: 'skip' }
  | { action: 'create_new'; row: number };

/**
 * Find the target row matching the logtime entry.
 *
 * Logic (4 steps):
 *   1. Match by M (Steam ID) → write J:K only
 *   2. Match by D (name, M empty) → write J:K + M
 *   3. Match by X+Y (registered outsider) → skip
 *   4. No match anywhere → create new X:Y entry
 */
function findRow(rows: string[][], name: string, steamId?: string): FindResult {
    const n = normalizeName(name);
    const s = steamId ? normalizeName(steamId) : undefined;

    /** Extract IC name from D cell e.g. "123 [MHNK-PD] Name" → "name" */
    function icNameFromD(cell: string): string {
        if (!cell) return '';
        const match = String(cell).match(/\]\s*(.+)$/);
        return match ? normalizeName(match[1]) : normalizeName(cell);
    }

    /** Check if normalised name matches the D cell (full or IC part) */
    function nameMatchesD(nameNorm: string, dCell: string): boolean {
        if (!dCell) return false;
        const fullNorm = normalizeName(dCell);
        const icNorm = icNameFromD(dCell);
        return fullNorm.includes(nameNorm) || icNorm.includes(nameNorm);
    }

    // STEP 1: Match by Steam ID (M column = row[9])
    if (s) {
        for (let idx = 2; idx < rows.length; idx++) {
            const mSteam = rows[idx]?.[9] ? normalizeName(rows[idx][9]) : '';
            if (mSteam === s) return { action: 'update_time', row: idx + 1 };
        }
    }

    // STEP 2: Match by name (D column = row[0]) — only if M is empty
    for (let idx = 2; idx < rows.length; idx++) {
        const dCell = rows[idx]?.[0] || '';
        if (!dCell) continue;
        // Skip if this row already has a Steam ID (belongs to someone else)
        if (rows[idx]?.[9] && String(rows[idx][9]).trim()) continue;
        if (nameMatchesD(n, dCell)) return { action: 'update_time_steam', row: idx + 1 };
    }

    // STEP 3: Check if person already exists in X+Y (registered outsider)
    if (s) {
        for (let idx = NEW_ROW_MIN - 1; idx < rows.length; idx++) {
            const xName = rows[idx]?.[20] ? normalizeName(rows[idx][20]) : '';
            const ySteam = rows[idx]?.[21] ? normalizeName(rows[idx][21]) : '';
            if (!xName) continue;
            const nameMatch = xName.includes(n) || n.includes(xName);
            const steamMatch = s && ySteam && ySteam === s;
            if (nameMatch && steamMatch) return { action: 'skip' };
        }
    }

    // STEP 4: Find first empty row (X column empty) and create new entry
    for (let r = NEW_ROW_MIN; r <= rows.length; r++) {
        if (!rows[r - 1]?.[20] || !String(rows[r - 1][20]).trim())
            return { action: 'create_new', row: r };
    }
    return { action: 'create_new', row: rows.length + 1 };
}

export async function processLogtime(info: LogtimeInfo): Promise<string> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return '❌ Config ไม่พร้อม';
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!D:Y`, 0);
    const result = findRow(rows, info.name, info.id);
    const updates: { range: string; values: string[][] }[] = [];

    switch (result.action) {
        case 'update_time':
            updates.push({ range: `${reg.sheetName}!J${result.row}:K${result.row}`, values: [[info.date, info.time]] });
            break;

        case 'update_time_steam':
            updates.push({ range: `${reg.sheetName}!J${result.row}:K${result.row}`, values: [[info.date, info.time]] });
            if (info.id) updates.push({ range: `${reg.sheetName}!M${result.row}`, values: [[info.id]] });
            break;

        case 'skip':
            logger.info('ลงเวลา', `${info.name} -> ข้าม (มี X+Y แล้ว)`);
            return `${info.name} -> ข้าม (มีในระบบแล้ว)`;

        case 'create_new':
            updates.push({ range: `${reg.sheetName}!X${result.row}`, values: [[info.name]] });
            if (info.id) updates.push({ range: `${reg.sheetName}!Y${result.row}`, values: [[info.id]] });
            break;
    }

    if (updates.length > 0) await sheetService.batchUpdateValues(reg.spreadsheetId, updates);

    const note = result.action === 'create_new'
        ? `ใหม่ที่ X${result.row}`
        : `แถว ${result.row}`;
    logger.info('ลงเวลา', `${info.name} -> ${note}`);
    return `${info.name} -> ${note}`;
}