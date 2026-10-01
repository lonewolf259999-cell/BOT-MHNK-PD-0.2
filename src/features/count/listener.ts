import { Client, Events, Guild } from 'discord.js';
import { silentCatch } from '../../services/utils';
import { configService } from '../../core/config.service';
import { processCountBatch, pendingCountOps } from './count.service';
import { logger } from '../../core/logger';
import { CACHE, COUNT } from '../../config';
import type { TagInfo } from '../../types/discord';

/**
 * จำว่าโพสไหนนับให้ใครไปแล้ว — เก็บเฉพาะ "รหัสคน" ไม่เก็บชื่อเล่น
 *
 * ชื่อเล่นไม่ต้องจำ เพราะตอนใช้งานจริงดึงจากข้อความสด ๆ ได้อยู่แล้ว
 * เก็บแค่รหัสทำให้จำโพสได้มากขึ้นราว 3 เท่าในหน่วยความจำเท่าเดิม
 */
const messageLog = new Map<string, string[]>();

/**
 * ตัวนับไว้สรุปลง log เป็นระยะ
 *
 * ของเดิมไม่บันทึกอะไรเลยนอกจากตอน error พอยอดในชีตไม่ตรงกับที่กดนับใหม่
 * จึงต้องมานั่งเดาสาเหตุทุกครั้ง ไม่มีร่องรอยว่าบอทตัดสินใจอะไรไปบ้าง
 */
const stats = { added: 0, removed: 0, unnamed: 0, editRefetched: 0, editUnreadable: 0, editOld: 0 };

/** กันไม่ให้เตือนเรื่องคนเดิมซ้ำ ๆ จนท่วม log — ล้างทิ้งทุกรอบสรุป */
const warnedUnnamed = new Set<string>();

/** อายุข้อความแบบอ่านง่าย ใช้ในข้อความแจ้งเตือน */
export function formatAge(ms: number): string {
    const mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 60) return `${mins} นาที`;
    return `${Math.floor(mins / 60)} ชม. ${mins % 60} นาที`;
}

/**
 * เลขที่ดึงมาจาก <@...> หน้าตาเป็น Discord ID จริงไหม (ตัวเลขล้วน 17–20 หลัก)
 *
 * เดิมมีการเช็คว่าหาตัวสมาชิกเจอไหม ซึ่งกรองเลขปลอมออกไปด้วยโดยปริยาย
 * พอเลิกเช็คตัวสมาชิกแล้ว ต้องมีตัวกรองรูปแบบมาแทน ไม่งั้นข้อความที่พิมพ์ <@123> มาเล่น ๆ
 * จะได้แถวใหม่ในชีตโดยที่ไม่มีคนนั้นอยู่จริง (ปุ่มนับใหม่ก็ไม่นับเลขปลอม ต้องให้ตรงกัน)
 */
export function looksLikeDiscordId(id: string): boolean {
    return /^\d{17,20}$/.test(id);
}

/** แท็กที่หาตัวสมาชิกไม่เจอ — ยังนับยอดให้ตามปกติ แค่จดไว้ว่าไม่รู้ชื่อ */
function noteUnnamedTag(id: string): void {
    stats.unnamed++;
    if (warnedUnnamed.has(id)) return;
    warnedUnnamed.add(id);
    logger.warn('นับเคส', `แท็ก ${id} หาตัวสมาชิกไม่เจอ (อาจออกจากเซิร์ฟแล้ว) — นับยอดให้ด้วยเลขไอดีตามปกติ`);
}

/**
 * แจ้งให้รู้ว่ามีการแก้ใบที่เก่าเกินกรอบเวลาที่ปกติจะมีคนแก้กัน
 * ไม่ได้ห้ามแก้ และยอดยังอัปเดตตามความจริงเหมือนเดิม — มีไว้เฝ้าดูเท่านั้น
 */
function noteOldEdit(msg: { url: string; createdTimestamp: number }): void {
    const hours = configService.getEditAlertHours();
    if (hours <= 0) return;
    const ageMs = Date.now() - msg.createdTimestamp;
    if (ageMs <= hours * 60 * 60 * 1000) return;
    stats.editOld++;
    logger.warn('นับเคส', `แก้ข้อความที่อายุ ${formatAge(ageMs)} (เกิน ${hours} ชม.) — ยอดอัปเดตให้ตามปกติ`, { ข้อความ: msg.url });
}

/** สรุปลง log แล้วเริ่มนับรอบใหม่ — ถ้าไม่มีอะไรเกิดขึ้นเลยก็ไม่ต้องรบกวน */
function logSummary(): void {
    const s = stats;
    if (!s.added && !s.removed && !s.unnamed && !s.editRefetched && !s.editUnreadable && !s.editOld) return;
    logger.info('นับเคส', 'สรุปรอบ', {
        นับเพิ่ม: s.added,
        หักออก: s.removed,
        แท็กที่ไม่รู้ชื่อ: s.unnamed,
        แก้ข้อความแล้วต้องไปดึงเนื้อหาใหม่: s.editRefetched,
        แก้ข้อความแต่อ่านเนื้อหาไม่ได้เลย: s.editUnreadable,
        แก้ข้อความที่เก่าเกินกำหนด: s.editOld,
        คิวที่ยังไม่ได้เขียนลงชีต: pendingCountOps(),
    });
    s.added = 0; s.removed = 0; s.unnamed = 0;
    s.editRefetched = 0; s.editUnreadable = 0; s.editOld = 0;
    warnedUnnamed.clear();
}

/**
 * ดึงคนที่ถูกแท็กออกจากข้อความ — นับด้วย "เลขไอดี" เป็นหลัก ไม่ใช่ตัวคน
 *
 * ของเดิมบังคับว่าต้องหาตัวสมาชิกใน cache เจอก่อนจึงจะนับ หาไม่เจอก็ทิ้งแท็กนั้นเงียบ ๆ
 * ซึ่งไม่จำเป็นเลย เพราะชีตค้นแถวด้วยเลขไอดีในคอลัมน์ B อยู่แล้ว ไม่ต้องรู้ชื่อก็นับได้
 * ชื่อจำเป็นแค่ตอนสร้างแถวใหม่ให้คนที่ยังไม่มีในชีต (ดู ensureUserRow)
 *
 * cache พร่องได้จริง: รายชื่อถูกโหลดครบแค่ครั้งเดียวตอนบอทเปิด ถ้าหลุดเน็ตแล้วต่อใหม่จะไม่โหลดซ้ำ
 * และคนที่ออกจากเซิร์ฟไปแล้วก็ไม่มีใน cache ตลอดไป — ยอดของเขาต้องนับ/หักได้ตามปกติ
 */
function getTagsFromMessage(content: string, guild: Guild): TagInfo[] {
    const tags: TagInfo[] = [];
    const regex = /<@!?(\d+)>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
        const id = m[1];
        if (tags.some(t => t.id === id)) continue;
        // ข้ามเลขที่ไม่ใช่ Discord ID — แต่ต้องบอกไว้ใน log ห้ามทิ้งแบบเงียบ ๆ
        if (!looksLikeDiscordId(id)) {
            logger.warn('นับเคส', `ข้ามแท็ก <@${id}> เพราะไม่ใช่ Discord ID (ต้องเป็นตัวเลข 17–20 หลัก)`);
            continue;
        }
        const member = guild.members.cache.get(id);
        if (!member) noteUnnamedTag(id);
        tags.push({
            id,
            nickname: member ? (member.nickname || member.displayName || member.user.username).trim() : '',
            username: member ? member.user.username : '',
        });
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

export type EditPlan =
    | { action: 'skip' }
    | { action: 'record'; tagIds: string[] }
    | { action: 'apply'; added: TagInfo[]; removedIds: string[]; tagIds: string[] };

/**
 * event "แก้ข้อความ" เข้ามาแล้วควรทำอะไรต่อ
 *
 * contentReadable = false แปลว่าอ่านเนื้อหาไม่ได้เลย (ดึงตัวจริงจาก Discord ก็ยังไม่ได้)
 * กรณีนั้นต้อง "ไม่ทำอะไร" เท่านั้น ห้ามตีความว่าแท็กถูกลบแล้วไปหักยอด
 *
 * นี่คือต้นเหตุที่ยอดในชีตหายเองทีละนิดในห้องที่คนโพสเยอะ:
 * discord.js จำเนื้อหาข้อความไว้แค่ 200 ใบต่อห้อง แต่ messageLog จำได้ 2,000 ใบ
 * ใบที่ตกอยู่ในช่องว่างนี้ พอมี event แก้ไขเข้ามา บอทจะอ่านได้ 0 แท็ก
 * ของเดิมเหมาว่า "แท็กถูกเอาออกหมดแล้ว" แล้วหักยอดทุกคนในใบนั้นทิ้ง ทั้งที่ไม่มีใครลบแท็กเลย
 */
export function planEdit(known: string[] | undefined, contentReadable: boolean, newTags: TagInfo[]): EditPlan {
    if (!contentReadable) return { action: 'skip' };
    const tagIds = newTags.map(t => t.id);
    if (!known) return { action: 'record', tagIds };
    const { added, removedIds } = diffTags(known, newTags);
    return { action: 'apply', added, removedIds, tagIds };
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
            stats.added += tags.length;
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
            stats.removed += ids.length;
            await processCountBatch(toRemovedTags(ids, message.guild), message.channel.id, true);
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageDelete: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    // กำหนด cleanup อัตโนมัติทุก 24 ชั่วโมง
    setInterval(cleanupLog, CACHE.COUNT_CLEANUP_INTERVAL_MS);
    cleanupLog(); // เรียกครั้งแรกตอน start

    // สรุปสถิติการนับลง log เป็นระยะ — ไว้ไล่ย้อนว่ายอดเพี้ยนเพราะอะไร ไม่ต้องเดาอีก
    setInterval(logSummary, COUNT.SUMMARY_INTERVAL_MS);

    client.on(Events.MessageUpdate, async (_oldM, newM) => {
        try {
            const cfg = configService.getCountConfig();
            if (!configService.isLoaded() || !cfg.CHANNELS || !newM.guild || !newM.channel) return;

            // ของเดิมไม่ได้กรองห้องตรงนี้ ทำให้แก้ข้อความห้องไหนในเซิร์ฟเวอร์ก็เข้าคิวนับหมด
            // สุดท้ายถูกข้ามตอน flush ก็จริง แต่ flush อ่าน Sheet ไปเรียบร้อยแล้วทุกครั้ง = เปลืองโควต้าเปล่า ๆ
            if (!allowedChannelIds(cfg).includes(newM.channel.id)) return;

            noteOldEdit(newM);

            const known = messageLog.get(newM.id);

            /*
             * ต้องอ่านเนื้อหาให้ได้ก่อน แล้วค่อยตัดสินใจเรื่องยอด (เหตุผลเต็มอยู่ที่ planEdit)
             * มองไม่เห็นก็ไปดึงตัวจริงจาก Discord มาอ่าน → ยอด "ถูกต้อง" ไม่ใช่แค่ "ไม่ผิด"
             * ดึงไม่ได้จริง ๆ → ปล่อยให้ planEdit สั่ง skip ห้ามเดาว่าแท็กถูกลบ
             */
            let content = newM.content;
            let readable = !newM.partial && content !== null;
            if (!readable) {
                try {
                    content = (await newM.fetch()).content;
                    readable = true;
                    stats.editRefetched++;
                } catch {
                    stats.editUnreadable++;
                    logger.warn('นับเคส', `แก้ข้อความ ${newM.id}: อ่านเนื้อหาไม่ได้และดึงตัวจริงไม่ได้ — ไม่แตะยอด`);
                }
            }

            const plan = planEdit(known, readable, readable ? getTagsFromMessage(content ?? '', newM.guild) : []);
            if (plan.action === 'skip') return;

            // ไม่เคยเห็นข้อความนี้ (messageLog อยู่ใน memory ล้วน บอทรีสตาร์ทแล้วหายหมด)
            // → บันทึกสถานะปัจจุบันไว้เฉย ๆ ไม่นับ เพื่อไม่ให้คะแนนซ้ำกับตอนที่นับไปแล้ว
            //    ถ้ายอดเพี้ยนจริงยังใช้ /recount รื้อนับใหม่ได้เสมอ
            if (plan.action === 'record') {
                messageLog.set(newM.id, plan.tagIds);
                cleanupLog();
                return;
            }

            if (plan.added.length > 0) {
                stats.added += plan.added.length;
                await processCountBatch(plan.added, newM.channel.id, false);
            }
            if (plan.removedIds.length > 0) {
                stats.removed += plan.removedIds.length;
                await processCountBatch(toRemovedTags(plan.removedIds, newM.guild), newM.channel.id, true);
            }

            messageLog.set(newM.id, plan.tagIds);
        } catch (e: unknown) {
            logger.error('นับเคส', `MessageUpdate: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}