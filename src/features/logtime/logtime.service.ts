import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName } from '../../services/utils';
import { logger } from '../../core/logger';
import { locks } from '../../core/lock.service';

interface LogtimeInfo {
    name: string;
    date: string;
    time: string;
    id?: string;
    inDate?: string;
    inTime?: string;
    duration?: string;
}

const WEEKDAY_COL: Record<number, string> = {
    1: 'O',  // Mon
    2: 'P',  // Tue
    3: 'Q',  // Wed
    4: 'R',  // Thu
    5: 'S',  // Fri
    6: 'T',  // Sat
    0: 'U',  // Sun
};

type FindResult =
    | { action: 'update_time'; row: number }
    | { action: 'update_time_steam'; row: number }
    | { action: 'skip' }
    | { action: 'create_new'; row: number };

/** Convert "HH:mm:ss" to total minutes */
export function timeToMinutes(durationStr: string): number {
    if (!durationStr) return 0;
    const [hrs, mins, secs] = durationStr.split(':').map(Number);
    return hrs * 60 + mins + Math.round(secs / 60);
}

/** Convert total minutes to "HH:mm" */
export function minutesToHHmm(totalMinutes: number): string {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/** Map a date string (DD/MM/YYYY) to column O-U based on day of week */
export function getColumnByDate(dateStr: string): string | null {
    if (!dateStr) return null;
    const [d, m, y] = dateStr.split('/').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const day = dateObj.getDay();
    return WEEKDAY_COL[day] || null;
}

/**
 * Single-pass findRow: iterate once, accumulate all candidates.
 *
 * Priority during scan:
 *   - Steam match (M col) → immediate return
 *   - Forward name match (D col, M empty) → bestCandidate
 *   - Backward name match (D col, M empty) → backupCandidate
 *   - X+Y skip check
 *   - First empty X row → newRowCandidate
 */
export function findRow(rows: string[][], name: string, steamId?: string): FindResult {
    const n = normalizeName(name);
    const s = steamId ? normalizeName(steamId) : undefined;

    let bestCandidate: { row: number; priority: number } | null = null;
    let firstEmptyX: number | null = null;

    for (let idx = 2; idx < rows.length; idx++) {
        const dCell = rows[idx]?.[0] || '';
        const mCell = rows[idx]?.[9] ? normalizeName(rows[idx][9]) : '';
        const xCell = rows[idx]?.[20] ? normalizeName(rows[idx][20]) : '';
        const yCell = rows[idx]?.[21] ? normalizeName(rows[idx][21]) : '';
        const hasM = rows[idx]?.[9] && String(rows[idx][9]).trim();

        // Track first empty X row for potential new entry
        if (firstEmptyX === null && (!xCell || !String(rows[idx][20]).trim())) {
            firstEmptyX = idx + 1;
        }

        // PRIORITY 1: Steam ID match → immediate return
        if (s && mCell === s) {
            return { action: 'update_time', row: idx + 1 };
        }

        // PRIORITY 2: Forward name match (D col, M empty)
        if (dCell && !hasM) {
            const fullNorm = normalizeName(dCell);
            const icMatch = dCell.match(/\]\s*(.+)$/);
            const icNorm = icMatch ? normalizeName(icMatch[1]) : normalizeName(dCell);

            if (fullNorm.includes(n) || icNorm.includes(n)) {
                if (!bestCandidate || bestCandidate.priority > 1) {
                    bestCandidate = { row: idx + 1, priority: 1 };
                }
            }
        }

        // PRIORITY 3: Backward name match (D col, M empty)
        if (dCell && !hasM && (!bestCandidate || bestCandidate.priority >= 2)) {
            const fullNorm = normalizeName(dCell);
            const icMatch = dCell.match(/\]\s*(.+)$/);
            const icNorm = icMatch ? normalizeName(icMatch[1]) : normalizeName(dCell);

            let backwardMatch = false;
            if (icNorm.length > 0 && icNorm.length < n.length) {
                if (n.slice(0, icNorm.length) === icNorm) backwardMatch = true;
            }
            if (!backwardMatch && fullNorm.length > 0 && fullNorm.length < n.length) {
                if (n.slice(0, fullNorm.length) === fullNorm) backwardMatch = true;
            }

            if (backwardMatch) {
                bestCandidate = { row: idx + 1, priority: 2 };
            }
        }

        // PRIORITY 4: X+Y skip check
        if (s && xCell && yCell) {
            const nameMatch = xCell.includes(n) || n.includes(xCell);
            const steamMatch = yCell === s;
            if (nameMatch && steamMatch) {
                return { action: 'skip' };
            }
        }
    }

    // Return best match found (name match = update_time_steam)
    if (bestCandidate) {
        return { action: 'update_time_steam', row: bestCandidate.row };
    }

    // Create new entry at first empty X row or end
    const newRow = firstEmptyX ?? (rows.length + 1);
    return { action: 'create_new', row: newRow };
}

/** Read current accumulated minutes from a weekday column (O-U) for a given row */
function getAccumulatedMinutes(rows: string[][], col: string, row: number): number {
    const rowData = rows[row - 1];
    if (!rowData) return 0;
    // Column index from range D:Y => D=0, E=1, ..., O=11, P=12, Q=13, R=14, S=15, T=16, U=17
    const colIndex = col.charCodeAt(0) - 68; // 'D'=68
    const cellVal = rowData[colIndex] || '00:00';
    if (!cellVal.includes(':')) return 0;
    const [h, m] = cellVal.split(':').map(Number);
    return h * 60 + m;
}

export async function processLogtime(info: LogtimeInfo): Promise<string> {
    return locks.logtime.run(async () => {
        const reg = configService.getRegistryConfig();
        if (!reg.spreadsheetId || !reg.sheetName) return '❌ Config ไม่พร้อม';
        // อ่านค่าไม่ใช้ cache (ttl=0) เพื่อป้องกันอ่านค่าที่ล้าสมัย
        const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!D:Y`, 0);
        const result = findRow(rows, info.name, info.id);
        const updates: { range: string; values: string[][] }[] = [];

        switch (result.action) {
            case 'update_time':
                updates.push({ range: `${reg.sheetName}!J${result.row}:K${result.row}`, values: [[info.date, info.time]] });
                accumulateWeekday(rows, updates, info, result.row, reg.sheetName);
                break;

            case 'update_time_steam':
                updates.push({ range: `${reg.sheetName}!J${result.row}:K${result.row}`, values: [[info.date, info.time]] });
                if (info.id) updates.push({ range: `${reg.sheetName}!M${result.row}`, values: [[info.id]] });
                accumulateWeekday(rows, updates, info, result.row, reg.sheetName);
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
    });
}

/** Accumulate time into weekday columns O-U */
function accumulateWeekday(
    rows: string[][],
    updates: { range: string; values: string[][] }[],
    info: LogtimeInfo,
    row: number,
    sheetName: string,
): void {
    const { duration, inDate, inTime, date } = info;
    if (!duration) return;

    const totalMinutes = timeToMinutes(duration);
    if (totalMinutes <= 0) return;

    // Cross-midnight: inDate !== date
    if (inDate && date && inDate !== date && inTime) {
        const [inH, inM, inS] = inTime.split(':').map(Number);
        const minutesInFirstDay = 1440 - (inH * 60 + inM + Math.round(inS / 60));
        const minutesInSecondDay = Math.max(0, totalMinutes - minutesInFirstDay);

        const colStart = getColumnByDate(inDate);
        const colEnd = getColumnByDate(date);

        if (colStart) {
            const oldMin = getAccumulatedMinutes(rows, colStart, row);
            const newTotal = oldMin + minutesInFirstDay;
            updates.push({ range: `${sheetName}!${colStart}${row}`, values: [[minutesToHHmm(newTotal)]] });
        }
        if (colEnd) {
            const oldMin = getAccumulatedMinutes(rows, colEnd, row);
            const newTotal = oldMin + minutesInSecondDay;
            updates.push({ range: `${sheetName}!${colEnd}${row}`, values: [[minutesToHHmm(newTotal)]] });
        }
    } else {
        // Single day
        const targetCol = getColumnByDate(date);
        if (targetCol) {
            const oldMin = getAccumulatedMinutes(rows, targetCol, row);
            const newTotal = oldMin + totalMinutes;
            updates.push({ range: `${sheetName}!${targetCol}${row}`, values: [[minutesToHHmm(newTotal)]] });
        }
    }
}