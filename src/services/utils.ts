/** Shared utility functions */
import { Guild, BaseGuildTextChannel } from 'discord.js';
import { logger } from '../core/logger';

export function normalizeName(str: string): string {
    return (str || '').trim().toLowerCase();
}

/**
 * Silent catch wrapper — logs the error instead of swallowing it silently.
 * Usage: await somePromise.catch(silentCatch('FeatureName'))
 */
export function silentCatch(context: string) {
    return (err: unknown) => {
        logger.warn(context, `⚠️ Suppressed error: ${err instanceof Error ? err.message : String(err)}`);
    };
}

/**
 * Reply ephemeral then auto-delete after delay ms (default 5000).
 * Same pattern as v0.1's ephemeral auto-delete.
 * Returns the timeout handle so callers can clear it if needed.
 */
const replyTimeouts = new Map<string, NodeJS.Timeout>();

export async function replyAndDelete(interaction: { editReply: (opts: { content: string }) => Promise<unknown>; id?: string; deleteReply: () => Promise<unknown> }, content: string, delay = 5000): Promise<NodeJS.Timeout | null> {
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
 * Get text channel from guild cache, returns null if not found or not text-based.
 */
export function getTextChannel(guild: Guild | null, channelId: string): BaseGuildTextChannel | null {
    if (!guild || !channelId) return null;
    const ch = guild.channels.cache.get(channelId);
    if (!ch || !ch.isTextBased()) return null;
    return ch as BaseGuildTextChannel;
}

