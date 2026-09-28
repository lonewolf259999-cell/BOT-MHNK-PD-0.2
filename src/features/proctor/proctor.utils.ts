import type { APIEmbed, Message } from 'discord.js';
import { embedHasText, hasWordUpper } from '../../services/embed-search';

/** ตรวจว่า embed มีคำว่า Proctor หรือไม่ */
function hasProctorInEmbed(embed: APIEmbed): boolean {
    return embedHasText(embed, hasWordUpper('PROCTOR'));
}

/** ตรวจว่าข้อความหรือ embed ใดๆ มี Proctor หรือไม่ */
export function hasProctorInMessage(msg: Message): boolean {
    if (msg.content?.toUpperCase().includes('PROCTOR')) return true;
    return msg.embeds?.some((e) => hasProctorInEmbed(e.toJSON())) ?? false;
}
