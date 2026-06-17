import { google, sheets_v4 } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { cache } from './cache';
import { CACHE } from '../config';
import { logger } from './logger';

interface CredentialsFile {
    client_email: string;
    private_key: string;
    type: string;
    project_id: string;
    private_key_id: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
    auth_provider_x509_cert_url: string;
    client_x509_cert_url: string;
    universe_domain: string;
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Centralized Google Sheets service with retry, rate limiting, cache, and error handling.
 * Uses the same credentials and sheet IDs as the original bot.
 */
export class SheetService {
    private auth: sheets_v4.Sheets | null = null;
    private keys: CredentialsFile;
    private lastRequestTime = 0;
    private readonly MIN_REQUEST_INTERVAL = 100; // 100ms between calls

    constructor() {
        const credPath = path.join(__dirname, '../../credentials.json');
        const raw = fs.readFileSync(credPath, 'utf8');
        this.keys = JSON.parse(raw) as CredentialsFile;
    }

    private getClient(): sheets_v4.Sheets {
        if (!this.auth) {
            const auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: this.keys.client_email,
                    private_key: this.keys.private_key,
                },
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            this.auth = google.sheets({ version: 'v4', auth });
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
            } catch (error: any) {
                lastError = error;
                const status = error?.response?.status;
                const isRetryable = !status || status === 429 || status === 500 || status === 503 || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';

                if (!isRetryable) {
                    logger.error('SHEET', `[${context}] Non-retryable error`, { status, message: error.message });
                    throw error;
                }

                if (attempt < MAX_RETRIES) {
                    const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
                    logger.warn('SHEET', `[${context}] Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms`, { status, message: error.message });
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    logger.error('SHEET', `[${context}] All ${MAX_RETRIES} attempts failed`, { status, message: error.message });
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