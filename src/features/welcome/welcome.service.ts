import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { truncateNickname, makeFullName } from '../../services/member.service';
import { logger } from '../../core/logger';

export async function isAlreadyRegistered(userId: string): Promise<boolean> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return false;
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!E:E`, 10000);
    if (rows.some(row => row[0] && row[0].toString().includes(userId))) return true;
    if (reg.outSheetName) {
        const outRows = await sheetService.getValues(reg.spreadsheetId, `${reg.outSheetName}!E:E`, 10000);
        return outRows.some(row => row[0] && row[0].toString().includes(userId));
    }
    return false;
}

export async function registerMember(icName: string, userId: string): Promise<{ nickname: string; fullNickname: string; wasTruncated: boolean } | null> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return null;
    if (await isAlreadyRegistered(userId)) { logger.warn('สมัคร', `ผู้ใช้ ${userId} พยายามสมัครซ้ำ`); return null; }

    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!C:D`, 0);
    let targetRow = -1, codeNumber = '';
    for (let i = 2; i < rows.length; i++) {
        if (rows[i][0] && (!rows[i][1] || rows[i][1].trim() === '')) { targetRow = i + 1; codeNumber = rows[i][0].trim(); break; }
    }
    if (targetRow === -1) {
        const dyn = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!C${rows.length + 1}:C${rows.length + 20}`, 0);
        for (let j = 0; j < dyn.length; j++) { if (dyn[j][0]) { targetRow = rows.length + j + 1; codeNumber = dyn[j][0].trim(); break; } }
    }
    if (targetRow === -1) { logger.warn('สมัคร', 'ไม่พบแถวว่างที่มีรหัส'); return null; }

    const fullNickname = makeFullName(codeNumber, icName);
    const today = new Date();
    const formattedDate = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
    await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!D${targetRow}:F${targetRow}`, [[fullNickname, `'<@${userId}>`, 'นักเรียนตำรวจ']]);
    await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!H${targetRow}`, [[formattedDate]]);
    const truncatedNick = truncateNickname(fullNickname);
    logger.info('สมัคร', `ลงทะเบียน ${fullNickname} แถว ${targetRow}`);
    return { nickname: truncatedNick, fullNickname, wasTruncated: fullNickname.length > 32 };
}

export async function moveMemberToOut(userId: string): Promise<void> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName || !reg.outSheetName) return;
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!B:M`, 0);
    let foundRow = -1, memberData: string[] = [];
    for (let i = 2; i < rows.length; i++) {
        if (rows[i] && rows[i][3] && rows[i][3].trim().includes(`<@${userId}>`)) {
            foundRow = i + 1; memberData = new Array(12).fill('');
            for (let c = 0; c < 12; c++) { if (rows[i][c] !== undefined) memberData[c] = rows[i][c].trim(); }
            break;
        }
    }
    if (foundRow === -1 || memberData.length === 0) { logger.warn('ย้ายออก', `ไม่พบข้อมูล ${userId}`); return; }
    const outRows = await sheetService.getValues(reg.spreadsheetId, `${reg.outSheetName}!B:B`, 0);
    let nextRow = outRows.length + 1; if (nextRow < 3) nextRow = 3;
    await sheetService.updateValues(reg.spreadsheetId, `${reg.outSheetName}!B${nextRow}:M${nextRow}`, [memberData]);
    // Batch clear — 1 API call instead of 16
    const clearCols = ['B', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];
    await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!B${foundRow}:U${foundRow}`, [new Array(clearCols.length).fill('')]).catch(() => {});
    logger.info('ย้ายออก', `ย้าย ${userId} ไป OutDC แถว ${nextRow}`);
}

export async function findMemberByDiscordId(userId: string): Promise<{ row: number; codeNumber: string; currentName: string } | null> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return null;
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!C:E`, 0);
    for (let i = 2; i < rows.length; i++) {
        if (rows[i]?.[2] && rows[i][2].trim().includes(userId)) return { row: i + 1, codeNumber: (rows[i][0] || '').trim(), currentName: (rows[i][1] || '').trim() };
    }
    return null;
}

export async function updateMemberName(row: number, newFullName: string): Promise<void> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return;
    await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!D${row}`, [[newFullName]]);
    logger.info('แก้ชื่อ', `อัปเดตแถว ${row} ชื่อเป็น ${newFullName}`);
}