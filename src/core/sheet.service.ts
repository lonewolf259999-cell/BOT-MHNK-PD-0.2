import { google, sheets_v4 } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { cache } from './cache';
import { CACHE } from '../config';

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

/**
 * Centralized Google Sheets service with retry, rate limiting, and cache.
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
     * Read values from sheet with cache.
     */
    async getValues(spreadsheetId: string, range: string, ttl?: number): Promise<string[][]> {
        const cacheKey = `sheet:${spreadsheetId}:${range}`;
        const cached = cache.get<string[][]>(cacheKey);
        if (cached) return cached;

        await this.throttle();
        const client = this.getClient();
        const res = await client.spreadsheets.values.get({ spreadsheetId, range });
        const data = (res.data.values as string[][]) || [];

        cache.set(cacheKey, data, ttl ?? CACHE.SHEET_TTL);
        return data;
    }

    /**
     * Update values in sheet (no cache).
     */
    async updateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
        await this.throttle();
        const client = this.getClient();
        await client.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });
        this.invalidateCache(spreadsheetId);
    }

    /**
     * Batch update multiple ranges.
     */
    async batchUpdateValues(spreadsheetId: string, data: { range: string; values: string[][] }[]): Promise<void> {
        await this.throttle();
        const client = this.getClient();
        await client.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data,
            },
        });
        this.invalidateCache(spreadsheetId);
    }

    /**
     * Clear specific cells.
     */
    async clearValues(spreadsheetId: string, range: string): Promise<void> {
        await this.throttle();
        const client = this.getClient();
        await client.spreadsheets.values.clear({ spreadsheetId, range });
        this.invalidateCache(spreadsheetId);
    }

    /**
     * Append values to a sheet.
     */
    async appendValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
        await this.throttle();
        const client = this.getClient();
        await client.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });
        this.invalidateCache(spreadsheetId);
    }

    private invalidateCache(spreadsheetId: string): void {
        cache.deleteByPrefix(`sheet:${spreadsheetId}:`);
    }
}

// Singleton
export const sheetService = new SheetService();