import { auth as googleAuth, sheets as sheetsApi, sheets_v4 } from '@googleapis/sheets';
import { cache } from './cache';
import { CACHE } from '../config';
import { logger } from './logger';
import { loadCredentials, type CredentialsFile } from './credentials';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * ดึงสถานะ HTTP และรหัสข้อผิดพลาดระดับ socket ออกจาก error ที่ Google โยนมา
 *
 * error จาก googleapis ไม่มีรูปร่างตายตัว — บางทีมี response.status บางทีมีแค่ code
 * แยกออกมาเป็นฟังก์ชันเดี่ยวเพื่อให้เทสได้โดยไม่ต้องต่อ Google จริง
 */
export function extractErrorInfo(error: unknown): { status?: number; code?: string } {
    const errObj = error as Record<string, unknown>;
    const status = typeof errObj?.response === 'object' && errObj.response
        ? (errObj.response as Record<string, unknown>).status as number | undefined
        : undefined;
    const code = typeof errObj?.code === 'string' ? errObj.code : undefined;
    return { status, code };
}

/**
 * ข้อผิดพลาดนี้ควรลองใหม่ไหม
 *
 * ไม่มี status  = ต่อไม่ติดตั้งแต่แรก (เน็ตหลุด / DNS พัง) → ลองใหม่ได้
 * 429           = เรายิงถี่เกินไป → รอแล้วลองใหม่
 * 500 / 503     = ฝั่ง Google เอง → รอแล้วลองใหม่
 * 400/403/404   = เราส่งผิดเอง (range ผิด, ไม่มีสิทธิ์, ไม่มีชีต) → ลองอีกกี่ครั้งก็ได้ผลเดิม
 */
export function isRetryableError(status?: number, code?: string): boolean {
    return !status || status === 429 || status === 500 || status === 503
        || code === 'ECONNRESET' || code === 'ETIMEDOUT';
}

/**
 * หน่วงก่อนลองใหม่ — 1 วิ, 2 วิ, 4 วิ บวก jitter สุ่มไม่เกิน 1 วิ
 *
 * jitter กันกรณีหลายคำสั่งพลาดพร้อมกัน แล้วกลับมายิง Google พร้อมกันเป็นฝูงซ้ำอีก
 * รับเป็นพารามิเตอร์ได้เพื่อให้เทสกำหนดค่าคงที่แทนการสุ่ม
 */
export function retryDelayMs(attempt: number, jitter: number = Math.random()): number {
    return INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + jitter * 1000;
}

/**
 * Centralized Google Sheets service with retry, rate limiting, cache, and error handling.
 * Uses the same credentials and sheet IDs as the original bot.
 */
export class SheetService {
    private auth: sheets_v4.Sheets | null = null;
    private keys: CredentialsFile | null = null;
    private lastRequestTime = 0;
    private readonly MIN_REQUEST_INTERVAL = 100; // 100ms between calls

    /**
     * อ่าน credentials ตอนใช้งานจริงครั้งแรก ไม่ใช่ตอน import
     *
     * ของเดิมอ่านไฟล์ใน constructor ซึ่งทำงานทันทีที่โมดูลถูก import
     * ผลคือ import ของ index.ts ถูก hoist ขึ้นไปทำงานก่อน validate() เสมอ
     * ถ้าไม่มีกุญแจจะได้ ENOENT ดิบ ๆ แทนข้อความบอกสาเหตุที่เขียนไว้ใน validate()
     * และไฟล์เทสที่ไม่เกี่ยวกับ Sheets เลยก็พังตามไปด้วย
     */
    private loadKeys(): CredentialsFile {
        if (this.keys) return this.keys;
        this.keys = loadCredentials();
        return this.keys;
    }

    private getClient(): sheets_v4.Sheets {
        if (!this.auth) {
            const keys = this.loadKeys();
            const auth = new googleAuth.GoogleAuth({
                credentials: {
                    client_email: keys.client_email,
                    private_key: keys.private_key,
                },
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            this.auth = sheetsApi({ version: 'v4', auth });
        }
        return this.auth;
    }

    private async throttle(): Promise<void> {
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < this.MIN_REQUEST_INTERVAL) {
            await new Promise(r => setTimeout(r, this.MIN_REQUEST_INTERVAL - elapsed));
        }
        this.lastRequestTime = Date.now();
    }

    /**
     * Execute a Google Sheets API call with retry (exponential backoff) and error logging.
     */
    private async executeWithRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await this.throttle();
                return await operation();
            } catch (error: unknown) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const { status, code } = extractErrorInfo(error);

                if (!isRetryableError(status, code)) {
                    logger.error('SHEET', `[${context}] Non-retryable error`, { status, message: lastError.message });
                    throw lastError;
                }

                if (attempt < MAX_RETRIES) {
                    const delay = retryDelayMs(attempt);
                    logger.warn('SHEET', `[${context}] Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms`, { status, message: lastError.message });
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    logger.error('SHEET', `[${context}] All ${MAX_RETRIES} attempts failed`, { status, message: lastError.message });
                }
            }
        }
        throw lastError ?? new Error(`${context} failed after ${MAX_RETRIES} retries`);
    }

    /**
     * Read values from sheet with cache.
     */
    async getValues(spreadsheetId: string, range: string, ttl?: number): Promise<string[][]> {
        const cacheKey = `sheet:${spreadsheetId}:${range}`;
        const cached = cache.get<string[][]>(cacheKey);
        if (cached) return cached;

        const client = this.getClient();
        const res = await this.executeWithRetry(
            () => client.spreadsheets.values.get({ spreadsheetId, range }),
            `getValues(${spreadsheetId}, ${range})`
        );
        const data = (res.data.values as string[][]) || [];

        cache.set(cacheKey, data, ttl ?? CACHE.SHEET_TTL);
        return data;
    }

    /**
     * Update values in sheet (no cache).
     */
    async updateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
        const client = this.getClient();
        await this.executeWithRetry(
            () => client.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            }),
            `updateValues(${spreadsheetId}, ${range})`
        );
        this.invalidateCache(spreadsheetId);
    }

    /**
     * Batch update multiple ranges.
     */
    async batchUpdateValues(spreadsheetId: string, data: { range: string; values: string[][] }[]): Promise<void> {
        const client = this.getClient();
        await this.executeWithRetry(
            () => client.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data,
                },
            }),
            `batchUpdateValues(${spreadsheetId})`
        );
        this.invalidateCache(spreadsheetId);
    }

    /**
     * Clear specific cells.
     */
    async clearValues(spreadsheetId: string, range: string): Promise<void> {
        const client = this.getClient();
        await this.executeWithRetry(
            () => client.spreadsheets.values.clear({ spreadsheetId, range }),
            `clearValues(${spreadsheetId}, ${range})`
        );
        this.invalidateCache(spreadsheetId);
    }

    /**
     * Append values to a sheet.
     *
     * valueInputOption:
     *   USER_ENTERED (ค่าเริ่มต้น) = ให้ Google ตีความเหมือนคนพิมพ์เอง เลขเป็นเลข วันที่เป็นวันที่
     *   RAW                        = เก็บเป็นข้อความเป๊ะ ๆ ตามที่ส่งไป
     *
     * ต้องมีตัวเลือกนี้เพราะ USER_ENTERED จะแปลงข้อความเวลาอย่าง "2026-10-02 03:47:11"
     * เป็นค่าวันที่ของ Google แล้วตอนอ่านกลับจะได้ "รูปแบบที่มันจัดแสดง" (เช่น 3:47:11)
     * ซึ่งไม่ตรงกับที่เขียนไป ทำให้โค้ดที่ต้องอ่านเวลากลับมาเทียบ (ลบ log เก่า) พังเงียบ ๆ
     */
    async appendValues(
        spreadsheetId: string,
        range: string,
        values: string[][],
        valueInputOption: 'USER_ENTERED' | 'RAW' = 'USER_ENTERED',
    ): Promise<void> {
        const client = this.getClient();
        await this.executeWithRetry(
            () => client.spreadsheets.values.append({
                spreadsheetId,
                range,
                valueInputOption,
                requestBody: { values },
            }),
            `appendValues(${spreadsheetId}, ${range})`
        );
        this.invalidateCache(spreadsheetId);
    }

    /**
     * หมายเลขภายในของแท็บ (ใช้กับคำสั่งที่แก้โครงชีต เช่นลบแถว)
     * ไม่ใช่ชื่อแท็บ — Google ต้องการตัวเลขนี้ ไม่ใช่ชื่อ
     */
    async getSheetTabId(spreadsheetId: string, title: string): Promise<number | null> {
        const client = this.getClient();
        const res = await this.executeWithRetry(
            () => client.spreadsheets.get({ spreadsheetId }),
            `getSheetTabId(${spreadsheetId}, ${title})`
        );
        for (const s of res.data.sheets ?? []) {
            if (s.properties?.title === title) return s.properties.sheetId ?? null;
        }
        return null;
    }

    /**
     * สร้างแท็บถ้ายังไม่มี แล้วใส่หัวตารางให้
     *
     * มีไว้ให้ระบบ log ซ่อมตัวเองได้ ถ้าใครเผลอลบแท็บทิ้ง — ไม่ใช่ให้ไปสร้างมือใหม่ทุกครั้ง
     * คืนค่า true เมื่อเพิ่งสร้างใหม่ เพื่อให้ผู้เรียก log บอกไว้ได้ว่าเกิดอะไรขึ้น
     */
    async ensureSheetTab(spreadsheetId: string, title: string, header: string[]): Promise<boolean> {
        const existing = await this.getSheetTabId(spreadsheetId, title);
        if (existing !== null) return false;

        const client = this.getClient();
        await this.executeWithRetry(
            () => client.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title,
                                gridProperties: { rowCount: 1000, columnCount: header.length, frozenRowCount: 1 },
                            },
                        },
                    }],
                },
            }),
            `ensureSheetTab(${spreadsheetId}, ${title})`
        );
        await this.updateValues(spreadsheetId, `${title}!A1`, [header]);
        return true;
    }

    /**
     * ลบแถวตามช่วง (นับจาก 0 และไม่รวมแถวปลาย — ตามที่ Google กำหนด)
     * ใช้ลบ log เก่า: ลบจากบนสุดลงมา เพราะเราต่อท้ายเสมอ แถวบนจึงเก่าสุด
     */
    async deleteRowRange(spreadsheetId: string, sheetTabId: number, startIndex: number, endIndex: number): Promise<void> {
        if (endIndex <= startIndex) return;
        const client = this.getClient();
        await this.executeWithRetry(
            () => client.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        deleteDimension: {
                            range: { sheetId: sheetTabId, dimension: 'ROWS', startIndex, endIndex },
                        },
                    }],
                },
            }),
            `deleteRowRange(${spreadsheetId}, ${sheetTabId}, ${startIndex}-${endIndex})`
        );
        this.invalidateCache(spreadsheetId);
    }

    private invalidateCache(spreadsheetId: string): void {
        cache.deleteByPrefix(`sheet:${spreadsheetId}:`);
    }
}

// Singleton
export const sheetService = new SheetService();