import { sheetService } from '../../core/sheet.service';
import { configService } from '../../core/config.service';
import { logger } from '../../core/logger';
import { locks } from '../../core/lock.service';
import { truncateNickname, makeFullName } from '../../services/member.service';

/**
 * ตรวจสอบสถานะ Pending Sheet สำหรับ Discord ID ที่กำหนด
 */
export async function checkPendingStatus(discordId: string): Promise<{ found: boolean; status?: string; icName?: string; icPhone?: string; ocAge?: string }> {
    const spreadsheetId = configService.getPendingSpreadsheetId();
    const sheetName = configService.getPendingSheetName();
    if (!spreadsheetId || !sheetName) return { found: false };
    try {
        const rows = await sheetService.getValues(spreadsheetId, `${sheetName}!A:H`, 0);
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const pendingId = (row[1] || '').trim();
            if (pendingId === discordId) {
                return {
                    found: true,
                    status: (row[7] || '').trim(),
                    icName: (row[3] || '').trim(),
                    icPhone: (row[4] || '').trim(),
                    ocAge: (row[5] || '').trim(),
                };
            }
        }
        return { found: false };
    } catch {
        return { found: false };
    }
}

/**
 * ตรวจสอบว่า Discord ID นี้ถูก Pre-approved (ผ่าน Admin Approve ใน Pending Sheet) หรือยัง
 */
export async function checkPreApproved(discordId: string): Promise<{ approved: boolean; icName?: string; icPhone?: string; ocAge?: string }> {
    const result = await checkPendingStatus(discordId);
    if (result.found && result.status === 'อนุมัติ') {
        logger.info('Pre-Approved', `พบ ${discordId} ผ่านการอนุมัติแล้ว (IC: ${result.icName})`);
        return { approved: true, icName: result.icName, icPhone: result.icPhone, ocAge: result.ocAge };
    }
    return { approved: false };
}

export async function isAlreadyRegistered(userId: string, bypassCache = false): Promise<boolean> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.sheetName) return false;
    const ttl = bypassCache ? 0 : 10000;
    const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!E:E`, ttl);
    if (rows.some(row => row[0] && row[0].toString().includes(userId))) return true;
    if (reg.outSheetName) {
        const outRows = await sheetService.getValues(reg.spreadsheetId, `${reg.outSheetName}!E:E`, ttl);
        return outRows.some(row => row[0] && row[0].toString().includes(userId));
    }
    return false;
}

export async function registerMember(icName: string, userId: string): Promise<{ nickname: string; wasTruncated: boolean } | null> {
    return locks.sheetMutation.run(async () => {
        if (await isAlreadyRegistered(userId, false)) {
            logger.warn('สมัคร', `ผู้ใช้ ${userId} พยายามสมัครซ้ำ (pre-check)`);
            return null;
        }

        try {
            const reg = configService.getRegistryConfig();
            if (!reg.spreadsheetId || !reg.sheetName) return null;

            const already = await isAlreadyRegistered(userId, true);
            if (already) {
                logger.warn('สมัคร', `ผู้ใช้ ${userId} สมัครซ้ำ (ตรวจพบใน Queue) — ข้าม`);
                return null;
            }

            const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!C:D`, 0);
            let targetRow = -1, codeNumber = '';

            for (let i = 2; i < rows.length; i++) {
                if (rows[i][0] && (!rows[i][1] || rows[i][1].trim() === '')) {
                    targetRow = i + 1;
                    codeNumber = rows[i][0].trim();
                    break;
                }
            }

            if (targetRow === -1) {
                const dyn = await sheetService.getValues(reg.spreadsheetId, `${reg.sheetName}!C${rows.length + 1}:C${rows.length + 20}`, 0);
                for (let j = 0; j < dyn.length; j++) {
                    if (dyn[j][0]) {
                        targetRow = rows.length + j + 1;
                        codeNumber = dyn[j][0].trim();
                        break;
                    }
                }
            }

            if (targetRow === -1) {
                logger.warn('สมัคร', 'ไม่พบแถวว่างที่มีรหัส');
                return null;
            }

            const fullNickname = makeFullName(codeNumber, icName);
            const truncatedNick = truncateNickname(fullNickname);
            const today = new Date();
            const formattedDate = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;

            await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!D${targetRow}:E${targetRow}`, [[truncatedNick, `'<@${userId}>`]]);
            await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!H${targetRow}`, [[formattedDate]]);
            logger.info('สมัคร', `ลงทะเบียน ${fullNickname} แถว ${targetRow}`);
            return { nickname: truncatedNick, wasTruncated: fullNickname.length > 32 };

        } catch (error) {
            logger.error('สมัคร', `เกิดข้อผิดพลาด: ${error}`);
            return null;
        }
    });
}

/**
 * ตรวจสอบว่า Discord ID นี้อยู่ใน OutDC (ถูกถอดออกจากระบบ) หรือไม่
 */
export async function checkInOutDc(userId: string): Promise<boolean> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.outSheetName) return false;
    try {
        const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.outSheetName}!E:E`, 0);
        return rows.some(row => row[0] && row[0].includes(userId));
    } catch {
        return false;
    }
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
    const truncated = truncateNickname(newFullName);
    await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!D${row}`, [[truncated]]);
    logger.info('แก้ชื่อ', `อัปเดตแถว ${row} ชื่อเป็น ${truncated}`);
}