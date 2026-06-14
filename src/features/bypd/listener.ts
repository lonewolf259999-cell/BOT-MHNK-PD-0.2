import { Client, Events } from 'discord.js';
import { configService } from '../../core/config.service';
import { processBypd } from './bypd.service';
import { hasBypdInMessage } from './bypd.utils';
import { logger } from '../../core/logger';

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
