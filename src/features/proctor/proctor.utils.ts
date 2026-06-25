import type { APIEmbed, Message } from 'discord.js';

/** ตรวจว่า embed มีคำว่า Proctor หรือไม่ */
export function hasProctorInEmbed(embed: APIEmbed): boolean {
    if (embed.title?.includes('📋 บันทึกการคุมสอบ Proctor')) return true;
    if (embed.title?.toUpperCase().includes('PROCTOR')) return true;
    if (embed.description?.toUpperCase().includes('PROCTOR')) return true;
    if (embed.fields?.some((f) => f.name?.toUpperCase().includes('PROCTOR') || f.value?.toUpperCase().includes('PROCTOR'))) return true;
    if (embed.footer?.text?.toUpperCase().includes('PROCTOR')) return true;
    return false;
}

/** ตรวจว่าข้อความหรือ embed ใดๆ มี Proctor หรือไม่ */
export function hasProctorInMessage(msg: Message): boolean {
    if (msg.content?.toUpperCase().includes('PROCTOR')) return true;
    return msg.embeds?.some((e) => hasProctorInEmbed(e.toJSON())) ?? false;
}