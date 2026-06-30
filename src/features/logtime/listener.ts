import { Client, Events, Message } from 'discord.js';
import { configService } from '../../core/config.service';
import { processLogtime } from './logtime.service';
import { logger } from '../../core/logger';

export function setupLogtimeFeature(client: Client): void {
    client.on(Events.MessageCreate, async (message: Message) => {
        try {
            const chId = configService.getLogtimeChannelId();
            if (!chId || message.channel.id !== chId || !configService.isLoaded()) return;
            const text = buildMessageText(message);
            const info = extractInfo(text);
            if (!info.name || !info.date) return;
            await processLogtime({
                name: info.name,
                date: info.date,
                time: info.time || '',
                id: info.id || undefined,
                inDate: info.inDate || undefined,
                inTime: info.inTime || undefined,
                duration: info.duration || undefined,
            });
        } catch (e: unknown) {
            logger.error('ลงเวลา', `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}

function buildMessageText(msg: Message): string {
    const lines: string[] = [];
    if (msg.content) lines.push(msg.content);
    if (msg.embeds) {
        msg.embeds.forEach((e) => {
            if (e.title) lines.push(e.title);
            if (e.description) lines.push(e.description);
            if (e.fields) {
                e.fields.forEach((f) => {
                    lines.push(f.name);
                    lines.push(f.value);
                });
            }
        });
    }
    return lines.filter(Boolean).join('\n');
}

export interface LogtimeInfo {
    name: string | null;
    inDate: string | null;
    inTime: string | null;
    date: string | null;
    time: string | null;
    duration: string | null;
    id: string | null;
}

const LOGTIME_PATTERNS = [
    /รายงาน(?:ตัว)?(?:เข้าเวร|เข้างาน|ปฏิบัติหน้าที่)ของ\s*[-–—]\s*(.+)/i,
    /ชื่อ\s*[-–—]\s*(.+)/i,
    /รายงานตัว\s*(.+)/i,
];

const IN_PATTERNS = [
    /เวลาเข้างาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
    /เข้างาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
    /เวลาเริ่ม[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
];

const OUT_PATTERNS = [
    /เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
    /ออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
    /เวลาเลิก[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
];

const DURATION_PATTERNS = [
    /ระยะเวลาที่เข้าเวร\s*\n?\s*(\d{2}:\d{2}:\d{2})/i,
    /ระยะเวลา[\s\S]*?(\d{2}:\d{2}:\d{2})/i,
    /รวมเวลา[\s\S]*?(\d{2}:\d{2}:\d{2})/i,
];

const STEAM_PATTERNS = [
    /(steam:\w+)/i,
    /(STEAM_\d:\d:\d+)/i,
];

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return m;
    }
    return null;
}

export function extractInfo(text: string): LogtimeInfo {
    const c = text.replace(/`/g, '').replace(/\*/g, '').replace(/\u200B/g, '');
    const nameMatch = firstMatch(c, LOGTIME_PATTERNS);
    const name = nameMatch?.[1]?.trim() || null;
    const inMatch = firstMatch(c, IN_PATTERNS);
    const outMatch = firstMatch(c, OUT_PATTERNS);
    const durMatch = firstMatch(c, DURATION_PATTERNS);
    const steamMatch = firstMatch(c, STEAM_PATTERNS);
    const duration = durMatch?.[1] || null;

    if (!name) {
        logger.warn('ลงเวลา', 'ไม่พบชื่อในข้อความ — อาจเปลี่ยนรูปแบบข้อความแล้ว');
    } else if (!outMatch && !inMatch) {
        logger.warn('ลงเวลา', 'ไม่พบข้อมูลเวลาเข้า/ออกงาน — อาจเปลี่ยนรูปแบบข้อความแล้ว');
    } else if (!outMatch && inMatch) {
        logger.warn('ลงเวลา', 'พบข้อมูลเข้างานแต่ไม่พบข้อมูลออกงาน — อาจเปลี่ยนรูปแบบข้อความแล้ว');
    }

    return {
        name,
        inDate: inMatch ? inMatch[1] : null,
        inTime: inMatch ? inMatch[2] : null,
        date: outMatch?.[1] || null,
        time: outMatch?.[2] || null,
        duration,
        id: steamMatch?.[1] || null,
    };
}