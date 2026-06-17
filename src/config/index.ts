import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// ---- Env Config ----
export const env = {
    botToken: process.env.BOT_TOKEN || '',
    clientId: process.env.CLIENT_ID || '',
    guildId: process.env.GUILD_ID || '',
    port: parseInt(process.env.PORT || '3000', 10),
    renderUrl: process.env.RENDER_EXTERNAL_URL || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
};

// ---- Google Sheet IDs (same as original) ----
export const SHEETS = {
    CONFIG_SHEET_ID: '1YV_BIFiilxUM9XrW1cSYZTOgne1JnKoCXtRw7PUCCGs',
    CONFIG_SHEET_NAME: 'config',
};

// ---- Cache TTLs ----
export const CACHE = {
    SHEET_TTL: 5000,        // 5 seconds for sheet reads
    RATE_LIMITER_CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // Cleanup rate limiter every 5 min
    COUNT_CLEANUP_INTERVAL_MS: 24 * 60 * 60 * 1000, // Cleanup message log every 24h
    MESSAGE_LOG_MAX_SIZE: 2000, // Max entries in messageLog before pruning
};

// ---- Bot Config ----
export const BOT = {
    MAX_RESTART_PER_DAY: 8,
    RESTART_RESET_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours
    WATCHDOG_TIMEOUT_MIN: 15,
    WATCHDOG_CHECK_INTERVAL_MS: 60000,
    SELF_PING_INTERVAL_MS: 7 * 60 * 1000,
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: 3000, // Wait before force exit
    RESTART_DELAY_MS: 15000, // Delay before restart
};

export function validate(): string[] {
    const errors: string[] = [];
    if (!env.botToken) errors.push('❌ BOT_TOKEN is missing — กรุณาใส่ BOT_TOKEN ใน .env');
    if (!env.clientId) errors.push('❌ CLIENT_ID is missing — กรุณาใส่ CLIENT_ID ใน .env');
    if (!env.guildId) errors.push('❌ GUILD_ID is missing — กรุณาใส่ GUILD_ID ใน .env');

    // เช็ค credentials.json
    const credPath = path.join(__dirname, '../../credentials.json');
    try {
        if (!fs.existsSync(credPath)) errors.push(`❌ credentials.json not found at ${credPath}`);
    } catch {
        errors.push(`❌ ไม่สามารถตรวจสอบ credentials.json`);
    }

    return errors;
}
