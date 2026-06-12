import { sheetService } from './sheet.service';
import { SHEETS } from '../config';
import { logger } from './logger';

export class ConfigService {
    private data: Record<string, string> = {};
    private loaded = false;
    private countConfig = { SPREADSHEET_ID: '', SHEET_NAME: '', CHANNELS: { CHANNEL_1: '', CHANNEL_2: '', CHANNEL_3: '', CHANNEL_4: '', CHANNEL_5: '' } };
    private registryConfig = { spreadsheetId: '', sheetName: '', outSheetName: '' };
    private welcomeChannelId = '';
    private logChannelId = '';
    private logtimeChannelId = '';
    private logCaseChannelId = '';
    private bypdSendChannelId = '';
    private proctorChannelId = '';

    async load(): Promise<void> {
        try {
            const rows = await sheetService.getValues(SHEETS.CONFIG_SHEET_ID, `${SHEETS.CONFIG_SHEET_NAME}!A:B`, 30000);
            this.data = {};
            for (const row of rows) { if (row[0]) this.data[row[0]] = row[1] ? row[1].trim() : ''; }
            const parts = (this.data.COUNT_CHANNEL_IDS || '').split(',');
            this.countConfig = { SPREADSHEET_ID: this.data.SPREADSHEET_ID || '', SHEET_NAME: this.data.SHEET_NAME || '', CHANNELS: { CHANNEL_1: (parts[0] || this.data.CHANNEL_ID_1 || '').trim(), CHANNEL_2: (parts[1] || this.data.CHANNEL_ID_2 || '').trim(), CHANNEL_3: (parts[2] || this.data.CHANNEL_ID_3 || '').trim(), CHANNEL_4: (parts[3] || this.data.CHANNEL_ID_4 || '').trim(), CHANNEL_5: (parts[4] || this.data.CHANNEL_ID_5 || '').trim() } };
            this.registryConfig = { spreadsheetId: this.data.REGISTRY_SPREADSHEET_ID || '', sheetName: this.data.REGISTRY_SHEET_NAME || '', outSheetName: this.data.REGISTRY_OUT_SHEET_NAME || '' };
            this.welcomeChannelId = this.data.WELCOME_CHANNEL_ID || '';
            this.logChannelId = this.data.LOG_CHANNEL_ID || '';
            this.logtimeChannelId = this.data.LOGTIME_CHANNEL_ID || '';
            this.logCaseChannelId = this.data.LOGCASE_CHANNEL_ID || '';
            this.bypdSendChannelId = this.data.BYPD_SEND_CHANNEL_ID || '';
            this.proctorChannelId = this.data.PROCTOR_CHANNEL_ID || '';
            this.loaded = true;
            logger.info('CONFIG', 'โหลด Config จาก Google Sheet สำเร็จ');
        } catch (error) {
            logger.error('CONFIG', 'โหลด Config จาก Google Sheet ไม่สำเร็จ', { error: String(error) });
            this.loaded = false;
            throw error;
        }
    }

    async reload(): Promise<void> { this.loaded = false; return this.load(); }
    isLoaded(): boolean { return this.loaded; }
    getRaw(key: string): string { return this.data[key] || ''; }
    getCountConfig() { return this.countConfig; }
    getRegistryConfig() { return this.registryConfig; }
    getWelcomeChannelId(): string { return this.welcomeChannelId; }
    getLogChannelId(): string { return this.logChannelId; }
    getLogtimeChannelId(): string { return this.logtimeChannelId; }
    getLogCaseChannelId(): string { return this.logCaseChannelId; }
    getBypdSendChannelId(): string { return this.bypdSendChannelId; }
    getProctorChannelId(): string { return this.proctorChannelId; }

    async writeConfigKeys(updates: [string, string][]): Promise<void> {
        const rows = await sheetService.getValues(SHEETS.CONFIG_SHEET_ID, `${SHEETS.CONFIG_SHEET_NAME}!A:B`, 0);
        const map = new Map<string, string>();
        for (const row of rows) { if (row[0]) map.set(row[0], row[1] || ''); }
        for (const [key, value] of updates) map.set(key, value);
        await sheetService.updateValues(SHEETS.CONFIG_SHEET_ID, `${SHEETS.CONFIG_SHEET_NAME}!A1`, Array.from(map.entries()).map(([k, v]) => [k, v]));
        await this.reload();
    }
}
export const configService = new ConfigService();