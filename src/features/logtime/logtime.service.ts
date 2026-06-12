import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName } from '../../services/utils';
import { logger } from '../../core/logger';

interface LogtimeInfo { name: string; date: string; time: string; id?: string; duration?: string; }
const NEW_ROW_MIN = 3;
const COL = { FIND_NAME: 'D', OUT_DATE: 'J', OUT_TIME: 'K', STEAM: 'M', NEW_NAME: 'X', NEW_STEAM: 'Y' };

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
function matchBackward(log: string, dCell: string): boolean {
    if (!log || !dCell) return false;
    const f = normalizeName(dCell), ic = icNameFromD(dCell);
    if (ic.length > 0 && ic.length < log.length && log.slice(0, ic.length) === ic) return true;
    if (f.length > 0 && f.length < log.length && log.slice(0, f.length) === f) return true;
    return false;
}

function findRow(rows: string[][], name: string, steamId?: string): { row: number; isNew: boolean } {
    const n = normalizeName(name);
    if (steamId) {
        const s = normalizeName(steamId);
        for (let idx = 2; idx < rows.length; idx++) {
            if (rows[idx]?.[9] && normalizeName(rows[idx][9]) === s && rows[idx]?.[0] && (matchForward(n, rows[idx][0]) || matchBackward(n, rows[idx][0])))
                return { row: idx + 1, isNew: false };
        }
    }
    for (let idx = 2; idx < rows.length; idx++) { if (rows[idx]?.[0] && matchForward(n, rows[idx][0])) return { row: idx + 1, isNew: false }; }
    let bestRow: number | null = null, bestLen = 0;
    for (let idx = 2; idx < rows.length; idx++) {
        const d = rows[idx]?.[0]; if (!d) continue;
        const f = normalizeName(d), ic = icNameFromD(d);
        if (ic.length > 0 && ic.length < n.length) { const p = n.slice(0, ic.length); if (p === ic && ic.length > bestLen) { bestRow = idx + 1; bestLen = ic.length; } }
        if (f.length > 0 && f.length < n.length && f.length > bestLen) { const p = n.slice(0, f.length); if (p === f) { bestRow = idx + 1; bestLen = f.length; } }
    }
    if (bestRow) return { row: bestRow, isNew: false };
    for (let idx = NEW_ROW_MIN - 1; idx < rows.length; idx++) { if (rows[idx]?.[20] && normalizeName(rows[idx][20]).includes(n)) return { row: idx + 1, isNew: false }; }
    for (let r = NEW_ROW_MIN; r <= rows.length; r++) { if (!rows[r - 1]?.[20] || !String(rows[r - 1][20]).trim()) return { row: r, isNew: true }; }
    return { row: rows.length + 1, isNew: true };
}

export async function processLogtime(info: LogtimeInfo): Promise<string> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return '❌ Config ไม่พร้อม';
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!D:Y`, 0);
    const { row, isNew } = findRow(rows, info.name, info.id);
    const updates: { range: string; values: string[][] }[] = [];
    if (isNew) { updates.push({ range: `${reg.sheetName}!X${row}`, values: [[info.name]] }); if (info.id) updates.push({ range: `${reg.sheetName}!Y${row}`, values: [[info.id]] }); }
    else { updates.push({ range: `${reg.sheetName}!J${row}:K${row}`, values: [[info.date, info.time]] }); if (info.id) updates.push({ range: `${reg.sheetName}!M${row}`, values: [[info.id]] }); }
    if (updates.length > 0) await sheetService.batchUpdateValues(reg.spreadsheetId, updates);
    const note = isNew ? `ใหม่ที่ X${row}` : `แถว ${row}`;
    logger.info('ลงเวลา', `${info.name} -> ${note}`);
    return `${info.name} -> ${note}`;
}