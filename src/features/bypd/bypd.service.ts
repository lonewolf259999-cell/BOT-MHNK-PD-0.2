import { EmbedBuilder, Message } from 'discord.js';
import { configService } from '../../core/config.service';
import { logger } from '../../core/logger';

export function extractContent(message: Message): string {
    const content = message.content ? message.content.trim() : '';
    if (content) return content;
    if (message.embeds.length > 0) {
        const texts: string[] = [];
        for (const embed of message.embeds) {
            if (embed.title) texts.push(embed.title);
            if (embed.description) texts.push(embed.description);
            embed.fields?.forEach(f => { if (f.name) texts.push(f.name); if (f.value) texts.push(f.value); });
            if (embed.footer?.text) texts.push(embed.footer.text);
        }
        return texts.join('\n');
    }
    return '';
}

async function resolveTags(guild: any, content: string): Promise<string[]> {
    const match = content.match(/(?:BYPD)\s+((?:\d{2,3}\s*)+)/i);
    const codes = match ? match[1].trim().split(/\s+/) : [];
    const tags: string[] = [];
    for (const code of codes) {
        const prefix = `${code} [MHNK-PD]`;
        let m = guild.members.cache.find((mm: any) => (mm.nickname || '').startsWith(prefix));
        if (!m) { const f = await guild.members.fetch({ query: code, limit: 10 }); m = f.find((mm: any) => (mm.nickname || '').startsWith(prefix)); }
        tags.push(m ? `<@${m.user.id}>` : `@${code}`);
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

export async function processBypd(message: Message): Promise<boolean> {
    const content = extractContent(message);
    if (!content.toUpperCase().includes('BYPD')) return false;
    const guild = message.guild; if (!guild) return false;
    const tags = await resolveTags(guild, content);
    const det = parseDetails(content);
    const chId = configService.getBypdSendChannelId();
    const ch = guild.channels.cache.get(chId);
    if (!ch || !ch.isTextBased()) return false;

    await ch.send({ content: tags.join(' ') || '-', embeds: [new EmbedBuilder().setTitle('📋 รายงานคดี BYPD').setColor(0x3b82f6).addFields({ name: '👮 เจ้าหน้าที่', value: det.officer, inline: true }, { name: '🔴 ผู้ต้องหา', value: det.offender, inline: true }, { name: '📁 คดี', value: det.caseInfo, inline: false }, { name: '🔒 จำคุก', value: det.jail, inline: true }, { name: '💰 ค่าปรับ', value: det.fine, inline: true }, { name: '🕐 เวลา', value: det.time, inline: true }).setTimestamp()] });
    try { await message.react('✅'); } catch {}
    logger.info('BYPD', `ส่ง BYPD ข้อความ ${message.id}`);
    return true;
}