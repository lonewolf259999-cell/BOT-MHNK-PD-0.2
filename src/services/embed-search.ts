import type { APIEmbed } from 'discord.js';

/**
 * ไล่หาข้อความในทุกที่ของกล่อง embed — หัวเรื่อง, คำอธิบาย, ชื่อช่อง, ค่าในช่อง, ท้ายกล่อง
 *
 * ก่อนหน้านี้โครงนี้ถูกเขียนซ้ำ 5 ชุด (BYPD, PD, อุ้มห่อ, TAKE2, Proctor)
 * ถ้าวันหนึ่งพบว่ามันหาไม่เจอในบางที่ ต้องไล่แก้ทั้ง 5 จุด ลืมจุดใดจุดหนึ่งก็จะตรวจเจอไม่เท่ากัน
 *
 * @param test ตัวตรวจว่าข้อความชิ้นนั้นเข้าเงื่อนไขไหม (แต่ละประเภทส่งเงื่อนไขของตัวเองมา)
 */
export function embedHasText(embed: APIEmbed, test: (text: string) => boolean): boolean {
    if (test(embed.title ?? '')) return true;
    if (test(embed.description ?? '')) return true;
    if (embed.fields?.some((f) => test(f.name ?? '') || test(f.value ?? ''))) return true;
    if (test(embed.footer?.text ?? '')) return true;
    return false;
}

/** เงื่อนไข: มีคำนี้ไหม โดยไม่สนตัวพิมพ์ใหญ่เล็ก */
export const hasWordUpper = (word: string) => (text: string): boolean => text.toUpperCase().includes(word);

/** เงื่อนไข: มีคำนี้ไหม แบบตรงตัว (ใช้กับภาษาไทยที่ไม่มีตัวพิมพ์ใหญ่เล็ก) */
export const hasWordExact = (word: string) => (text: string): boolean => text.includes(word);

/** เงื่อนไข: เข้ารูปแบบนี้ไหม */
export const matchesPattern = (pattern: RegExp) => (text: string): boolean => pattern.test(text);
