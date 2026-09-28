import type { APIEmbed, Message } from 'discord.js';
import { embedHasText, hasWordUpper, hasWordExact, matchesPattern } from '../../services/embed-search';

/** รูปแบบรหัส PD — แยกให้ไม่ชนกับคำว่า BYPD */
const PD_CODE = /\bPD\s+\d{2,3}/i;

/** ตรวจว่า embed มีคำว่า BYPD หรือไม่ */
export function hasBypdInEmbed(embed: APIEmbed): boolean {
    return embedHasText(embed, hasWordUpper('BYPD'));
}

/** ตรวจว่า embed มี PD หรือไม่ (ใช้ regex เพื่อไม่ให้ชนกับ BYPD) */
export function hasPdInEmbed(embed: APIEmbed): boolean {
    return embedHasText(embed, matchesPattern(PD_CODE));
}

/** ตรวจว่า embed มีคำว่า อุ้มห่อ หรือไม่ */
export function hasCarryInEmbed(embed: APIEmbed): boolean {
    return embedHasText(embed, hasWordExact('อุ้มห่อ'));
}

/** ตรวจว่า embed มีคำว่า TAKE2 หรือไม่ */
export function hasTake2InEmbed(embed: APIEmbed): boolean {
    return embedHasText(embed, hasWordUpper('TAKE2'));
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

/** ตรวจว่าข้อความหรือ embed ใดๆ มีคำว่า อุ้มห่อ หรือไม่ */
export function hasCarryInMessage(msg: Message): boolean {
    if (msg.content?.includes('อุ้มห่อ')) return true;
    return msg.embeds?.some((e) => hasCarryInEmbed(e.toJSON())) ?? false;
}

/** ตรวจว่าข้อความหรือ embed ใดๆ มีคำว่า TAKE2 หรือไม่ */
export function hasTake2InMessage(msg: Message): boolean {
    if (msg.content?.toUpperCase().includes('TAKE2')) return true;
    return msg.embeds?.some((e) => hasTake2InEmbed(e.toJSON())) ?? false;
}
