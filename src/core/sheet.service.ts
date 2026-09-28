import { auth as googleAuth, sheets as sheetsApi, sheets_v4 } from '@googleapis/sheets';
import { cache } from './cache';
import { CACHE } from '../config';
import { logger } from './logger';
import { loadCredentials, type CredentialsFile } from './credentials';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

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
                const errObj = error as Record<string, unknown>;
                const status = typeof errObj?.response === 'object' && errObj.response ? (errObj.response as Record<string, unknown>).status as number | undefined : undefined;
                const code = typeof errObj?.code === 'string' ? errObj.code : undefined;
                const isRetryable = !status || status === 429 || status === 500 || status === 503 || code === 'ECONNRESET' || code === 'ETIMEDOUT';

                if (!isRetryable) {
                    logger.error('SHEET', `[${context}] Non-retryable error`, { status, message: lastError.message });
                    throw lastError;
                }

                if (attempt < MAX_RETRIES) {
                    const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
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
     */
    async appendValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
        const client = this.getClient();
        await this.executeWithRetry(
            () => client.spreadsheets.values.append({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            }),
            `appendValues(${spreadsheetId}, ${range})`
        );
        this.invalidateCache(spreadsheetId);
    }

    private invalidateCache(spreadsheetId: string): void {
        cache.deleteByPrefix(`sheet:${spreadsheetId}:`);
    }
}

// Singleton
export const sheetService = new SheetService();