import { Client, Events, Message } from 'discord.js';
import { configService } from '../../core/config.service';
import { processProctor } from './proctor.service';
import { hasProctorInMessage } from './proctor.utils';
import { logger } from '../../core/logger';

export function setupProctorFeature(client: Client): void {
    client.on(Events.MessageCreate, async (message: Message) => {
        try {
            const logCaseId = configService.getLogCaseChannelId();
            if (!logCaseId || message.channel.id !== logCaseId) return;
            if (!hasProctorInMessage(message)) return;
            await processProctor(message);
        } catch (e: unknown) {
            logger.error('PROCTOR', `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}