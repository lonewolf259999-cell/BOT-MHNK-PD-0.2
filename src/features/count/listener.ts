import { Client, Events, Guild } from 'discord.js';
import { silentCatch } from '../../services/utils';
import { configService } from '../../core/config.service';
import { processCountBatch } from './count.service';
import { logger } from '../../core/logger';
import { CACHE } from '../../config';
import type { TagInfo } from '../../types/discord';

/**
 * จำว่าโพสไหนนับให้ใครไปแล้ว — เก็บเฉพาะ "รหัสคน" ไม่เก็บชื่อเล่น
 *
 * ชื่อเล่นไม่ต้องจำ เพราะตอนใช้งานจริงดึงจากข้อความสด ๆ ได้อยู่แล้ว
 * เก็บแค่รหัสทำให้จำโพสได้มากขึ้นราว 3 เท่าในหน่วยความจำเท่าเดิม
 */
const messageLog = new Map<string, string[]>();

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

function allowedChannelIds(cfg: ReturnType<typeof configService.getCountConfig>): string[] {
    const ch = cfg.CHANNELS;
    return [ch.CHANNEL_1, ch.CHANNEL_2, ch.CHANNEL_3, ch.CHANNEL_4, ch.CHANNEL_5].filter(Boolean);
}

export interface TagDelta {
    added: TagInfo[];
    removedIds: string[];
}

/**
 * ส่วนต่างของแท็กระหว่างของเดิมกับของใหม่ ใช้ตอนมีคนแก้ข้อความ
 *
 * knownIds = undefined แปลว่าไม่เคยเห็นข้อความนี้ใน messageLog — คืนส่วนต่างเปล่า
 * เพราะเราไม่รู้ว่าเดิมแท็กใครไว้ ถ้าเหมาว่าแท็กปัจจุบันทั้งหมดคือ "ของที่เพิ่งเพิ่ม"
 * คะแนนจะไปซ้ำกับที่นับไปแล้วตอนข้อความถูกส่งครั้งแรก
 */
export function diffTags(knownIds: string[] | undefined, next: TagInfo[]): TagDelta {
    if (!knownIds) return { added: [], removedIds: [] };
    const oldIds = new Set(knownIds);
    const newIds = new Set(next.map(x => x.id));
    return {
        added: next.filter(x => !oldIds.has(x.id)),
        removedIds: knownIds.filter(id => !newIds.has(id)),
    };
}

/**
 * คนที่ถูกเอาออกจากแท็ก — เราจำไว้แค่รหัส ต้องหาข้อมูลคนกลับมาเพื่อส่งให้ระบบนับ
 * หาไม่เจอ (เช่นลาออกไปแล้ว) ก็ยังหักยอดได้ เพราะแถวในชีตค้นด้วยรหัสเป็นหลักอยู่แล้ว
 */
function toRemovedTags(ids: string[], guild: Guild): TagInfo[] {
    return ids.map(id => {
        const member = guild.members.cache.get(id);
        return {
            id,
            nickname: member ? (member.nickname || member.displayName || member.user.username).trim() : '',
            username: member ? member.user.username : '',
        };
    });
}

function cleanupLog(): void {
    if (messageLog.size > CACHE.MESSAGE_LOG_MAX_SIZE) {
        const keys = [...messageLog.keys()].slice(0, Math.floor(messageLog.size / 2));
        for (const k of keys) messageLog.delete(k);
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
            if (!message.guild || !allowedChannelIds(cfg).includes(message.channel.id)) return;
            const tags = getTagsFromMessage(message.content, message.guild);
            if (tags.length === 0) return;
            await message.react('✅').catch(silentCatch('Count'));
            if (messageLog.has(message.id)) return;
            messageLog.set(message.id, tags.map(t => t.id));
            cleanupLog();
            await processCountBatch(tags, message.channel.id, false);
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageCreate: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    client.on(Events.MessageDelete, async (message) => {
        try {
            const cfg = configService.getCountConfig();
            if (!configService.isLoaded() || !cfg.CHANNELS) return;
            const ids = messageLog.get(message.id);
            if (!ids || !message.guild) return;
            messageLog.delete(message.id);
            cleanupLog();
            await processCountBatch(toRemovedTags(ids, message.guild), message.channel.id, true);
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageDelete: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    // กำหนด cleanup อัตโนมัติทุก 24 ชั่วโมง
    setInterval(cleanupLog, CACHE.COUNT_CLEANUP_INTERVAL_MS);
    cleanupLog(); // เรียกครั้งแรกตอน start

    client.on(Events.MessageUpdate, async (_oldM, newM) => {
        try {
            const cfg = configService.getCountConfig();
            if (!configService.isLoaded() || !cfg.CHANNELS || !newM.guild || !newM.channel) return;

            // ของเดิมไม่ได้กรองห้องตรงนี้ ทำให้แก้ข้อความห้องไหนในเซิร์ฟเวอร์ก็เข้าคิวนับหมด
            // สุดท้ายถูกข้ามตอน flush ก็จริง แต่ flush อ่าน Sheet ไปเรียบร้อยแล้วทุกครั้ง = เปลืองโควต้าเปล่า ๆ
            if (!allowedChannelIds(cfg).includes(newM.channel.id)) return;

            const newTags = getTagsFromMessage(newM.content || '', newM.guild);
            const known = messageLog.get(newM.id);

            // ไม่เคยเห็นข้อความนี้ (messageLog อยู่ใน memory ล้วน บอทรีสตาร์ทแล้วหายหมด)
            // → บันทึกสถานะปัจจุบันไว้เฉย ๆ ไม่นับ เพื่อไม่ให้คะแนนซ้ำกับตอนที่นับไปแล้ว
            //    ถ้ายอดเพี้ยนจริงยังใช้ /recount รื้อนับใหม่ได้เสมอ
            if (!known) {
                messageLog.set(newM.id, newTags.map(t => t.id));
                cleanupLog();
                return;
            }

            const { added, removedIds } = diffTags(known, newTags);

            if (added.length > 0) {
                await processCountBatch(added, newM.channel.id, false);
            }
            if (removedIds.length > 0) {
                await processCountBatch(toRemovedTags(removedIds, newM.guild), newM.channel.id, true);
            }

            messageLog.set(newM.id, newTags.map(t => t.id));
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageUpdate: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}