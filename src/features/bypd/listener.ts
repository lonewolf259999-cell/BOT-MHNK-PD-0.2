import { Client, Events } from 'discord.js';
import { configService } from '../../core/config.service';
import { processBypd } from './bypd.service';
import { logger } from '../../core/logger';

/** ตรวจสอบว่าข้อความหรือ embed ใดๆ มีคำว่า BYPD หรือไม่ */
function hasBypdInMessage(message: any): boolean {
    if (message.content?.toUpperCase().includes('BYPD')) return true;
    if (message.embeds?.length > 0) {
        for (const embed of message.embeds) {
            if (embed.title?.toUpperCase().includes('BYPD')) return true;
            if (embed.description?.toUpperCase().includes('BYPD')) return true;
            if (embed.fields?.some((f: any) => f.name?.toUpperCase().includes('BYPD') || f.value?.toUpperCase().includes('BYPD'))) return true;
            if (embed.footer?.text?.toUpperCase().includes('BYPD')) return true;
        }
    }
    return false;
}

export function setupBypdFeature(client: Client): void {
    client.on(Events.MessageCreate, async (message) => {
        try {
            const logCaseId = configService.getLogCaseChannelId();
            if (!logCaseId || message.channel.id !== logCaseId) return;
            if (!hasBypdInMessage(message)) return;
            await processBypd(message);
        } catch (e) { logger.error('BYPD', `ผิดพลาด: ${e}`); }
    });
}
