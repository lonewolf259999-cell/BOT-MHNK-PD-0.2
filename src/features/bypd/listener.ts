import { Client, Events, Message } from 'discord.js';
import { configService } from '../../core/config.service';
import { processBypd } from './bypd.service';
import { hasBypdOrPdInMessage } from './bypd.utils';
import { logger } from '../../core/logger';

export function setupBypdFeature(client: Client): void {
    client.on(Events.MessageCreate, async (message: Message) => {
        try {
            const logCaseId = configService.getLogCaseChannelId();
            const logTake2Id = configService.getLogTake2ChannelId();
            if (!logCaseId && !logTake2Id) return;
            if (message.channel.id !== logCaseId && message.channel.id !== logTake2Id) return;
            if (!hasBypdOrPdInMessage(message)) return;
            await processBypd(message);
        } catch (e: unknown) {
            logger.error('BYPD', `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}