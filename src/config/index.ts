import dotenv from 'dotenv';
import path from 'path';

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

// ---- Rate Limit Defaults ----
export const RATE_LIMITS = {
    global: { windowMs: 60000, maxRequests: 20 },
    logtime: { windowMs: 300000, maxRequests: 10 },
    register: { windowMs: 60000, maxRequests: 3 },
    edittag: { windowMs: 10000, maxRequests: 5 },
    reload: { windowMs: 30000, maxRequests: 3 },
};

// ---- Cache TTLs ----
export const CACHE = {
    SHEET_TTL: 5000,        // 5 seconds for sheet reads
    MEMBER_TTL: 60000,      // 1 minute for member cache
};

// ---- Discord ----
export const INTENTS = [
    'Guilds',
    'GuildMessages',
    'MessageContent',
    'GuildMembers',
] as const;

export const PARTIALS = [
    'Message',
    'Channel',
    'Reaction',
] as const;

// ---- Bot Config ----
export const BOT = {
    MAX_RESTART_PER_DAY: 8,
    WATCHDOG_TIMEOUT_MIN: 15,
    WATCHDOG_CHECK_INTERVAL_MS: 60000,
    SELF_PING_INTERVAL_MS: 7 * 60 * 1000,
};

export function validate(): string[] {
    const errors: string[] = [];
    if (!env.botToken) errors.push('BOT_TOKEN is missing');
    return errors;
}