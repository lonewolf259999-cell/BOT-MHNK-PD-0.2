import { EmbedBuilder, Message } from 'discord.js';
import { configService } from '../../core/config.service';
import { logger } from '../../core/logger';
import { sleep } from '../../services/utils';

/** กัน process message ซ้ำ (message.id เดียว) */
const processedMessages = new Set<string>();

/** Tag cache: key = รหัส (เลข 2-3 หลัก), TTL 60 วิ */
const tagCache = new Map<string, { tag: string; expires: number }>();

/** Queue: ส่งทีละ 1 รายงาน ป้องกัน Discord rate limit */
let activeSends = 0;
const MAX_CONCURRENT = 1;

async function sendWithQueue(ch: any, guild: any, content: string): Promise<boolean> {
    while (activeSends >= MAX_CONCURRENT) {
        await sleep(200);
    }
    activeSends++;
    try {
        await sendBypdReport(ch, guild, content);
        return true;
    } catch (err) {
        logger.error('BYPD', `ส่งรายงานล้มเหลว: ${err}`);
        return false;
    } finally {
        activeSends--;
    }
}

/** ดึงข้อความจาก embed เดียว */
function extractEmbedContent(embed: any): string {
    const texts: string[] = [];
    if (embed.title) texts.push(embed.title);
    if (embed.description) texts.push(embed.description);
    embed.fields?.forEach((f: any) => { if (f.name) texts.push(f.name); if (f.value) texts.push(f.value); });
    if (embed.footer?.text) texts.push(embed.footer.text);
    return texts.join('\n');
}

async function resolveTags(guild: any, content: string): Promise<string[]> {
    const match = content.match(/(?:BYPD)\s+((?:\d{2,3}\s*)+)/i);
    const codes = match ? match[1].trim().split(/\s+/) : [];
    const tags: string[] = [];
    const now = Date.now();

    for (const code of codes) {
        const prefix = `${code} [MHNK-PD]`;

        // 1. เช็ค cache ก่อน
        const cached = tagCache.get(code);
        if (cached && now < cached.expires) {
            tags.push(cached.tag);
            continue;
        }

        // 2. หาจาก members.cache (ไม่มี API call)
        let m = guild.members.cache.find((mm: any) => (mm.nickname || '').startsWith(prefix));

        // 3. ถ้าไม่เจอ → เรียก API
        if (!m) {
            try {
                const f = await guild.members.fetch({ query: code, limit: 10 });
                m = f.find((mm: any) => (mm.nickname || '').startsWith(prefix));
            } catch {
                // members.fetch ล้มเหลว → ใช้ @code
            }
        }

        const tag = m ? `<@${m.user.id}>` : `@${code}`;
        tagCache.set(code, { tag, expires: now + 60000 });
        tags.push(tag);
    }
    return tags;
}

function parseDetails(content: string) {
    const lines = content.split('\n');
    const r: Record<string, string> = { officer: '-', offender: '-', caseInfo: '-', jail: '-', fine: '-', time: '-' };
    for (const raw of lines) {
        const l = raw.replace(/\*\*/g, '').trim(); if (!l) continue;
        if (l.includes('ผู้ต้องหา')) { const m = l.match(/ผู้ต้องหา\s+(.+?)(?:\s+ถูกจับโดย|$)/); if (m) r.offender = m[1].trim(); }
        if (l.includes('เจ้าหน้าที่')) { const m = l.match(/เจ้าหน้าที่\s+(.+)/); if (m) r.officer = m[1].trim(); }
        if (l.includes('คดี :')) r.caseInfo = l.split('คดี :')[1].trim();
        if (l.includes('จำคุก :')) r.jail = l.split('จำคุก :')[1].trim();
        if (l.includes('ค่าปรับ :')) r.fine = l.split('ค่าปรับ :')[1].trim();
        if (l.includes('/') && l.includes(':')) { const t = l.match(/\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}/); if (t) r.time = t[0]; }
    }
    return r;
}

/** ส่ง report BYPD หนึ่งคดี (1 embed หรือ 1 content) */
async function sendBypdReport(ch: any, guild: any, content: string): Promise<void> {
    const tags = await resolveTags(guild, content);
    const det = parseDetails(content);
    await ch.send({
        content: tags.join(' ') || '-',
        embeds: [new EmbedBuilder()
            .setTitle('📋 รายงานคดี BYPD')
            .setColor(0x3b82f6)
            .addFields(
                { name: '👮 เจ้าหน้าที่', value: det.officer, inline: true },
                { name: '🔴 ผู้ต้องหา', value: det.offender, inline: true },
                { name: '📁 คดี', value: det.caseInfo, inline: false },
                { name: '🔒 จำคุก', value: det.jail, inline: true },
                { name: '💰 ค่าปรับ', value: det.fine, inline: true },
                { name: '🕐 เวลา', value: det.time, inline: true }
            )
            .setTimestamp()
        ]
    });
}

/** ตรวจสอบว่า embed มีคำว่า BYPD หรือไม่ */
function hasBypdInEmbed(embed: any): boolean {
    if (embed.title?.toUpperCase().includes('BYPD')) return true;
    if (embed.description?.toUpperCase().includes('BYPD')) return true;
    if (embed.fields?.some((f: any) => f.name?.toUpperCase().includes('BYPD') || f.value?.toUpperCase().includes('BYPD'))) return true;
    if (embed.footer?.text?.toUpperCase().includes('BYPD')) return true;
    return false;
}

export async function processBypd(message: Message): Promise<boolean> {
    // ป้องกัน process message ID ซ้ำ
    if (processedMessages.has(message.id)) return false;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 60000);

    const guild = message.guild; if (!guild) return false;
    const chId = configService.getBypdSendChannelId();
    const ch = guild.channels.cache.get(chId);
    if (!ch || !ch.isTextBased()) return false;

    let count = 0;

    // 1. เช็ค message.content
    if (message.content?.trim() && message.content.toUpperCase().includes('BYPD')) {
        const ok = await sendWithQueue(ch, guild, message.content.trim());
        if (ok) count++;
        await sleep(1000);
    }

    // 2. วนลูปทุก embed (1 embed = 1 คดี)
    for (const embed of message.embeds) {
        if (hasBypdInEmbed(embed)) {
            const content = extractEmbedContent(embed);
            const ok = await sendWithQueue(ch, guild, content);
            if (ok) count++;
            await sleep(1000);
        }
    }

    if (count > 0) {
        // ✅ reaction แรก = บอกว่าระบบ process แล้ว (สำหรับระบบส่งย้อนหลัง)
        try { await message.react('✅'); } catch {}

        // อิโมจิที่ 2 = บอกจำนวนคดี (ถ้ามากกว่า 1)
        if (count > 1) {
            const emojiMap: Record<number, string> = {
                2: '2️⃣', 3: '3️⃣', 4: '4️⃣', 5: '5️⃣',
                6: '6️⃣', 7: '7️⃣', 8: '8️⃣', 9: '9️⃣', 10: '🔟',
            };
            const emoji = emojiMap[count];
            if (emoji) {
                try { await message.react(emoji); } catch {}
            }
        }
        logger.info('BYPD', `ส่ง ${count} คดี จากข้อความ ${message.id}`);
    }
    return count > 0;
}