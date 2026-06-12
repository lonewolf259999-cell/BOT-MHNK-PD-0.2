/**
 * Simple structured logger - no external dependencies.
 * Logs to console with timestamps.
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function log(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'INFO' ? '\x1b[36m' : '\x1b[90m';
    const reset = '\x1b[0m';
    console.log(`${color}[${ts}] [${level}] [${context}] ${message}${reset}${metaStr}`);
}

export const logger = {
    info: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('INFO', ctx, msg, meta),
    warn: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('WARN', ctx, msg, meta),
    error: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('ERROR', ctx, msg, meta),
    debug: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('DEBUG', ctx, msg, meta),
};