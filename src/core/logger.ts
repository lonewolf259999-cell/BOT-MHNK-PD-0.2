/**
 * Simple structured logger - no external dependencies.
 * Logs to console and file with timestamps.
 */

import fs from 'fs';
import path from 'path';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    const line = `[${ts}] [${level}] [${context}] ${message}${metaStr}\n`;
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'INFO' ? '\x1b[36m' : '\x1b[90m';
    const reset = '\x1b[0m';
    // eslint-disable-next-line no-console
    console.log(`${color}[${ts}] [${level}] [${context}] ${message}${reset}${metaStr}`);
    fs.appendFileSync(LOG_FILE, line);
}

export const logger = {
    info: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('INFO', ctx, msg, meta),
    warn: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('WARN', ctx, msg, meta),
    error: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('ERROR', ctx, msg, meta),
    debug: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('DEBUG', ctx, msg, meta),
};