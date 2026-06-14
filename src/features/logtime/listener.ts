import { Client, Events } from 'discord.js';
import { configService } from '../../core/config.service';
import { processLogtime } from './logtime.service';
import { logger } from '../../core/logger';

export function setupLogtimeFeature(client: Client): void {
    client.on(Events.MessageCreate, async (message) => {
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
        } catch (e) { logger.error('ลงเวลา', `ผิดพลาด: ${e}`); }
    });
}

function buildMessageText(msg: any): string {
    const lines: string[] = [];
    if (msg.content) lines.push(msg.content);
    if (msg.embeds) msg.embeds.forEach((e: any) => { lines.push(e.title, e.description); e.fields?.forEach((f: any) => lines.push(f.name, f.value)); });
    return lines.filter(Boolean).join('\n');
}
function extractInfo(text: string) {
    const c = text.replace(/`/g, '').replace(/\*/g, '').replace(/\u200B/g, '');
    const name = (c.match(/รายงานเข้าเวรของ\s*[-–—]\s*(.+)/i) || [])[1]?.trim() || null;
    const inMatch = c.match(/เวลาเข้างาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const outMatch = c.match(/เวลาออกงาน[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const duration = (c.match(/ระยะเวลาที่เข้าเวร\s*\n?\s*(\d{2}:\d{2}:\d{2})/i) || [])[1] || null;
    return {
        name,
        inDate: inMatch ? inMatch[1] : null,
        inTime: inMatch ? inMatch[2] : null,
        date: outMatch?.[1] || null,
        time: outMatch?.[2] || null,
        duration,
        id: (c.match(/(steam:\w+)/i) || [])[1] || null,
    };
}