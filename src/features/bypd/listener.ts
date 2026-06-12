import { Client, Events } from 'discord.js';
import { configService } from '../../core/config.service';
import { processBypd, extractContent } from './bypd.service';
import { logger } from '../../core/logger';

export function setupBypdFeature(client: Client): void {
    client.on(Events.MessageCreate, async (message) => {
        try {
            const logCaseId = configService.getLogCaseChannelId();
            if (!logCaseId || message.channel.id !== logCaseId) return;
            const hasContent = message.content?.trim();
            const hasEmbed = message.embeds.length > 0;
            if (!hasContent && !hasEmbed) return;
            const content = extractContent(message);
            if (content && content.toUpperCase().includes('BYPD')) await processBypd(message);
        } catch (e) { logger.error('BYPD', `ผิดพลาด: ${e}`); }
    });
}