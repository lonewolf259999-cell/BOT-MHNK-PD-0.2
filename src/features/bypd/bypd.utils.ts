import type { APIEmbed, Message } from 'discord.js';

/** ตรวจว่า embed มีคำว่า BYPD หรือไม่ */
export function hasBypdInEmbed(embed: APIEmbed): boolean {
    if (embed.title?.toUpperCase().includes('BYPD')) return true;
    if (embed.description?.toUpperCase().includes('BYPD')) return true;
    if (embed.fields?.some((f) => f.name?.toUpperCase().includes('BYPD') || f.value?.toUpperCase().includes('BYPD'))) return true;
    if (embed.footer?.text?.toUpperCase().includes('BYPD')) return true;
    return false;
}

/** ตรวจว่าข้อความหรือ embed ใดๆ มี BYPD หรือไม่ */
export function hasBypdInMessage(msg: Message): boolean {
    if (msg.content?.toUpperCase().includes('BYPD')) return true;
    return msg.embeds?.some((e) => hasBypdInEmbed(e.toJSON())) ?? false;
}