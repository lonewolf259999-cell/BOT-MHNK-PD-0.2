import { sheetService } from '../../core/sheet.service';
import { silentCatch } from '../../services/utils';
import { configService } from '../../core/config.service';
import { logger } from '../../core/logger';
import { locks } from '../../core/lock.service';
import { truncateNickname, makeFullName } from '../../services/member.service';

/**
 * ตรวจสอบว่า Discord ID นี้ถูก Pre-approved (ผ่าน Admin Approve ใน Pending Sheet) หรือยัง
 */
export async function checkPreApproved(discordId: string): Promise<{ approved: boolean; icName?: string; icPhone?: string; ocAge?: string }> {
    const spreadsheetId = configService.getPendingSpreadsheetId();
    const sheetName = configService.getPendingSheetName();
    if (!spreadsheetId || !sheetName) return { approved: false };

    try {
        const rows = await sheetService.getValues(spreadsheetId, `${sheetName}!A:H`, 0);
        // ข้ามแถว 0 (Header row)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const pendingDiscordId = (row[1] || '').trim(); // Column B = Discord ID
            const status = (row[7] || '').trim();           // Column H = สถานะ
            if (pendingDiscordId === discordId && status === 'อนุมัติ') {
                const icName = (row[3] || '').trim();   // Column D = ชื่อ IC
                const icPhone = (row[4] || '').trim();  // Column E = เบอร์ IC
                const ocAge = (row[5] || '').trim();    // Column F = อายุ OOC
                logger.info('Pre-Approved', `พบ ${discordId} ผ่านการอนุมัติแล้ว (IC: ${icName})`);
                return { approved: true, icName, icPhone, ocAge };
            }
        }
        return { approved: false };
    } catch (err) {
        logger.error('Pre-Approved', `ตรวจสอบ Pending Sheet ล้มเหลว: ${err}`);
        return { approved: false };
    }
}

// 🔥 Queue System ป้องกัน race condition — ทำให้ registerMember ทำงานทีละคน
let registrationQueue: Promise<any> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
    registrationQueue = registrationQueue.then(task, task).catch((e) => {
        logger.error('สมัคร', `Queue error: ${e}`);
        return undefined;
    });
    return registrationQueue as Promise<T>;
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
    if (await isAlreadyRegistered(userId, false)) {
        logger.warn('สมัคร', `ผู้ใช้ ${userId} พยายามสมัครซ้ำ (pre-check)`);
        return null;
    }
    return enqueue(() => _executeRegister(icName, userId));
}

async function _executeRegister(icName: string, userId: string): Promise<{ nickname: string; wasTruncated: boolean } | null> {
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

        await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!D${targetRow}:F${targetRow}`, [[truncatedNick, `'<@${userId}>`, 'นักเรียนตำรวจ']]);
        await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!H${targetRow}`, [[formattedDate]]);
        logger.info('สมัคร', `ลงทะเบียน ${fullNickname} แถว ${targetRow}`);
        return { nickname: truncatedNick, wasTruncated: fullNickname.length > 32 };
    } catch (error) {
        logger.error('สมัคร', `เกิดข้อผิดพลาด: ${error}`);
        return null;
    }
}

/**
 * ตรวจสอบว่า Discord ID นี้อยู่ใน OutDC (ถูกถอดออกจากระบบ) หรือไม่
 */
export async function checkInOutDc(userId: string): Promise<boolean> {
    const reg = configService.getRegistryConfig();
    if (!reg.spreadsheetId || !reg.outSheetName) return false;
    try {
        const rows = await sheetService.getValues(reg.spreadsheetId, `${reg.outSheetName}!B:B`, 0);
        return rows.some(row => row[0] && row[0].includes(userId));
    } catch {
        return false;
    }
}

export async function moveMemberToOut(userId: string): Promise<void> {
    return locks.sheetMutation.run(async () => {
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
        // ลบข้อมูลเฉพาะ D, E, F (ชื่อ, Discord ID, ตำแหน่ง) ไม่ลบคอลัมน์ C (Code)
        const clearCols = ['D', 'E', 'F', 'G', 'H'];
        await sheetService.updateValues(reg.spreadsheetId, `${reg.sheetName}!D${foundRow}:H${foundRow}`, [new Array(5).fill('')]).catch(silentCatch('Welcome'));
        logger.info('ย้ายออก', `ย้าย ${userId} ไป OutDC แถว ${nextRow} (คง C ไว้)`);
    });
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