/** Shared utility functions */
import { logger } from '../core/logger';

export function normalizeName(str: string): string {
    return (str || '').trim().toLowerCase();
}

/**
 * Silent catch wrapper — logs the error instead of swallowing it silently.
 * Usage: await somePromise.catch(silentCatch('FeatureName'))
 */
export function silentCatch(context: string) {
    return (err: any) => {
        logger.warn(context, `⚠️ Suppressed error: ${err?.message || err}`);
    };
}

/**
 * Reply ephemeral then auto-delete after delay ms (default 5000).
 * Same pattern as v0.1's ephemeral auto-delete.
 * Returns the timeout handle so callers can clear it if needed.
 */
const replyTimeouts = new Map<string, NodeJS.Timeout>();

export async function replyAndDelete(interaction: any, content: string, delay = 5000): Promise<NodeJS.Timeout | null> {
    try {
        await interaction.editReply({ content });
        const key = interaction.id || `${Date.now()}_${Math.random()}`;
        // Clear previous timeout for this interaction if any
        const prev = replyTimeouts.get(key);
        if (prev) clearTimeout(prev);
        const timeout = setTimeout(() => {
            interaction.deleteReply().catch(silentCatch('replyAndDelete'));
            replyTimeouts.delete(key);
        }, delay);
        replyTimeouts.set(key, timeout);
        return timeout;
    } catch { return null; }
}

/**
 * Clean up all pending reply timeouts (e.g. on bot shutdown).
 */
export function clearAllReplyTimeouts(): void {
    for (const [, timeout] of replyTimeouts) clearTimeout(timeout);
    replyTimeouts.clear();
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Centralized rate limit helper.
 * Replaces duplicate Map + logic in each feature.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

/**
 * Check if action is rate limited.
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(key: string, windowMs: number, limit: number): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
}

/**
 * Clear rate limit for a key (e.g. on success).
 */
export function clearRateLimit(key: string): void {
    rateLimitMap.delete(key);
}

/**
 * Get text channel from guild cache, returns null if not found or not text-based.
 */
export function getTextChannel(guild: any, channelId: string): any | null {
    if (!guild || !channelId) return null;
    const ch = guild.channels.cache.get(channelId);
    return ch?.isTextBased?.() ? ch : null;
}

/**
 * Extract Discord User ID from a cell that may contain `<@ID>` or just `ID`
 */
export function extractUserId(cell: string): string | null {
    if (!cell) return null;
    const match = String(cell).match(/\d{17,19}/);
    return match ? match[0] : null;
}