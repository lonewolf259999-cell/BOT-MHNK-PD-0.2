import type { APIEmbed, Message } from 'discord.js';

/** ตรวจว่า embed มีคำว่า BYPD หรือไม่ */
export function hasBypdInEmbed(embed: APIEmbed): boolean {
    if (embed.title?.toUpperCase().includes('BYPD')) return true;
    if (embed.description?.toUpperCase().includes('BYPD')) return true;
    if (embed.fields?.some((f) => f.name?.toUpperCase().includes('BYPD') || f.value?.toUpperCase().includes('BYPD'))) return true;
    if (embed.footer?.text?.toUpperCase().includes('BYPD')) return true;
    return false;
}

/** ตรวจว่า embed มี PD หรือไม่ (ใช้ regex เพื่อไม่ให้ชนกับ BYPD) */
export function hasPdInEmbed(embed: APIEmbed): boolean {
    const pdRegex = /\bPD\s+\d{2,3}/i;
    if (pdRegex.test(embed.title || '')) return true;
    if (pdRegex.test(embed.description || '')) return true;
    if (embed.fields?.some((f) => pdRegex.test(f.name || '') || pdRegex.test(f.value || ''))) return true;
    if (pdRegex.test(embed.footer?.text || '')) return true;
    return false;
}

/** ตรวจว่าข้อความหรือ embed ใดๆ มี BYPD หรือ PD หรือไม่ */
export function hasBypdOrPdInMessage(msg: Message): boolean {
    if (msg.content?.toUpperCase().includes('BYPD')) return true;
    if (msg.content && /\bPD\s+\d{2,3}/.test(msg.content)) return true;
    return msg.embeds?.some((e) => {
        const json = e.toJSON();
        return hasBypdInEmbed(json) || hasPdInEmbed(json);
    }) ?? false;
}