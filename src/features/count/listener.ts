import { Client, Events, Message, Guild, GuildMember, MessageFlags } from 'discord.js';
import { silentCatch } from '../../services/utils';
import { configService } from '../../core/config.service';
import { processCountBatch } from './count.service';
import { logger } from '../../core/logger';
import { CACHE } from '../../config';
import type { TagInfo } from '../../types/discord';

const messageLog = new Map<string, TagInfo[]>();
let lastCleanup = Date.now();

function getTagsFromMessage(content: string, guild: Guild): TagInfo[] {
    const tags: TagInfo[] = [];
    const regex = /<@!?(\d+)>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
        const member = guild.members.cache.get(m[1]);
        if (member && !tags.some(t => t.id === member.id)) {
            tags.push({
                id: member.id,
                nickname: (member.nickname || member.displayName || member.user.username).trim(),
                username: member.user.username,
            });
        }
    }
    return tags;
}

function cleanupLog(): void {
    const n = Date.now();
    if (n - lastCleanup > CACHE.COUNT_CLEANUP_INTERVAL_MS) {
        if (messageLog.size > CACHE.MESSAGE_LOG_MAX_SIZE) {
            // ถ้าเกิน max size ให้ลบ oldest 50% ทิ้ง
            const keys = [...messageLog.keys()].slice(0, Math.floor(messageLog.size / 2));
            for (const k of keys) messageLog.delete(k);
        } else {
            messageLog.clear();
        }
        lastCleanup = n;
    }
}

export function setupCountFeature(client: Client): void {
    client.once(Events.ClientReady, async () => {
        try {
            for (const g of client.guilds.cache.values()) await g.members.fetch();
            logger.info('นับเคส', 'แคชสมาชิกเรียบร้อย');
        } catch (e: unknown) {
            logger.error('นับเคส', `แคชผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    client.on(Events.MessageCreate, async (message) => {
        try {
            const cfg = configService.getCountConfig();
            if (!configService.isLoaded() || !cfg.CHANNELS) return;
            const allowed = [cfg.CHANNELS.CHANNEL_1, cfg.CHANNELS.CHANNEL_2, cfg.CHANNELS.CHANNEL_3, cfg.CHANNELS.CHANNEL_4, cfg.CHANNELS.CHANNEL_5].filter(Boolean);
            if (!message.guild || !allowed.includes(message.channel.id)) return;
            const tags = getTagsFromMessage(message.content, message.guild);
            if (tags.length === 0) return;
            await message.react('✅').catch(silentCatch('Count'));
            if (messageLog.has(message.id)) return;
            messageLog.set(message.id, tags);
            await processCountBatch(tags, message.channel.id, false);
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageCreate: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    client.on(Events.MessageDelete, async (message) => {
        try {
            const cfg = configService.getCountConfig();
            if (!configService.isLoaded() || !cfg.CHANNELS) return;
            const tags = messageLog.get(message.id);
            if (!tags) return;
            messageLog.delete(message.id);
            cleanupLog();
            await processCountBatch(tags, message.channel.id, true);
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageDelete: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    // กำหนด cleanup อัตโนมัติทุก 24 ชั่วโมง
    setInterval(cleanupLog, CACHE.COUNT_CLEANUP_INTERVAL_MS);
    cleanupLog(); // เรียกครั้งแรกตอน start

    client.on(Events.MessageUpdate, async (oldM, newM) => {
        try {
            const cfg = configService.getCountConfig();
            if (!configService.isLoaded() || !cfg.CHANNELS || !newM.guild || !newM.channel) return;

            const oldTags = messageLog.get(newM.id) || [];
            const newTags = getTagsFromMessage(newM.content || '', newM.guild);

            const oldIds = new Set(oldTags.map(x => x.id));
            const newIds = new Set(newTags.map(x => x.id));

            const added = newTags.filter(x => !oldIds.has(x.id));
            const removed = oldTags.filter(x => !newIds.has(x.id));

            if (added.length > 0) {
                await processCountBatch(added, newM.channel.id, false);
            }
            if (removed.length > 0) {
                await processCountBatch(removed, newM.channel.id, true);
            }

            messageLog.set(newM.id, newTags);
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageUpdate: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}