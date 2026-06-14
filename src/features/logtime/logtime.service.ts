import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { normalizeName } from '../../services/utils';
import { logger } from '../../core/logger';

interface LogtimeInfo {
    name: string;
    date: string;
    time: string;
    id?: string;
    inDate?: string;
    inTime?: string;
    duration?: string;
}

const NEW_ROW_MIN = 3;

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
function timeToMinutes(durationStr: string): number {
    if (!durationStr) return 0;
    const [hrs, mins, secs] = durationStr.split(':').map(Number);
    return hrs * 60 + mins + Math.round(secs / 60);
}

/** Convert total minutes to "HH:mm" */
function minutesToHHmm(totalMinutes: number): string {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/** Map a date string (DD/MM/YYYY) to column O-U based on day of week */
function getColumnByDate(dateStr: string): string | null {
    if (!dateStr) return null;
    const [d, m, y] = dateStr.split('/').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const day = dateObj.getDay();
    return WEEKDAY_COL[day] || null;
}

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

    /** Check if normalised name matches the D cell (forward match) */
    function nameMatchesD(nameNorm: string, dCell: string): boolean {
        if (!dCell) return false;
        const fullNorm = normalizeName(dCell);
        const icNorm = icNameFromD(dCell);
        return fullNorm.includes(nameNorm) || icNorm.includes(nameNorm);
    }

    /** Backward match: if log name is longer than cell name (trimmed), compare prefix */
    function nameMatchesDBackward(nameNorm: string, dCell: string): boolean {
        if (!dCell) return false;
        const fullNorm = normalizeName(dCell);
        const icNorm = icNameFromD(dCell);

        // Try IC part first (name after ])
        if (icNorm.length > 0 && icNorm.length < nameNorm.length) {
            const partial = nameNorm.slice(0, icNorm.length);
            if (partial === icNorm) return true;
        }
        // Try full cell
        if (fullNorm.length > 0 && fullNorm.length < nameNorm.length) {
            const partial = nameNorm.slice(0, fullNorm.length);
            if (partial === fullNorm) return true;
        }
        return false;
    }

    // STEP 1: Match by Steam ID (M column = row[9])
    if (s) {
        for (let idx = 2; idx < rows.length; idx++) {
            const mSteam = rows[idx]?.[9] ? normalizeName(rows[idx][9]) : '';
            if (mSteam === s) return { action: 'update_time', row: idx + 1 };
        }
    }

    // STEP 2: Match by name (D column = row[0]) — only if M is empty
    // Forward match first (priority)
    for (let idx = 2; idx < rows.length; idx++) {
        const dCell = rows[idx]?.[0] || '';
        if (!dCell) continue;
        if (rows[idx]?.[9] && String(rows[idx][9]).trim()) continue;
        if (nameMatchesD(n, dCell)) return { action: 'update_time_steam', row: idx + 1 };
    }
    // Backward match second (fallback for trimmed names)
    for (let idx = 2; idx < rows.length; idx++) {
        const dCell = rows[idx]?.[0] || '';
        if (!dCell) continue;
        if (rows[idx]?.[9] && String(rows[idx][9]).trim()) continue;
        if (nameMatchesDBackward(n, dCell)) return { action: 'update_time_steam', row: idx + 1 };
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
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return '❌ Config ไม่พร้อม';
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!D:Y`, 0);
    const result = findRow(rows, info.name, info.id);
    const updates: { range: string; values: string[][] }[] = [];

    switch (result.action) {
        case 'update_time':
            updates.push({ range: `${reg.sheetName}!J${result.row}:K${result.row}`, values: [[info.date, info.time]] });
            // Accumulate O-U for existing members
            accumulateWeekday(rows, updates, info, result.row, reg.sheetName);
            break;

        case 'update_time_steam':
            updates.push({ range: `${reg.sheetName}!J${result.row}:K${result.row}`, values: [[info.date, info.time]] });
            if (info.id) updates.push({ range: `${reg.sheetName}!M${result.row}`, values: [[info.id]] });
            // Accumulate O-U for existing members
            accumulateWeekday(rows, updates, info, result.row, reg.sheetName);
            break;

        case 'skip':
            logger.info('ลงเวลา', `${info.name} -> ข้าม (มี X+Y แล้ว)`);
            return `${info.name} -> ข้าม (มีในระบบแล้ว)`;

        case 'create_new':
            updates.push({ range: `${reg.sheetName}!X${result.row}`, values: [[info.name]] });
            if (info.id) updates.push({ range: `${reg.sheetName}!Y${result.row}`, values: [[info.id]] });
            // No O-U for new X:Y entries
            break;
    }

    if (updates.length > 0) await sheetService.batchUpdateValues(reg.spreadsheetId, updates);

    const note = result.action === 'create_new'
        ? `ใหม่ที่ X${result.row}`
        : `แถว ${result.row}`;
    logger.info('ลงเวลา', `${info.name} -> ${note}`);
    return `${info.name} -> ${note}`;
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