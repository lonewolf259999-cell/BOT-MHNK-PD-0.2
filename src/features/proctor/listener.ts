import { Client, Events } from 'discord.js';
import { configService } from '../../core/config.service';
import { logger } from '../../core/logger';

export function isProctorEmbed(embed: any): boolean { return embed?.title?.includes('📋 บันทึกการคุมสอบ Proctor') === true; }

export async function forwardProctorMessage(message: any, client: Client): Promise<boolean> {
    const embed = message.embeds?.[0];
    if (!embed || !isProctorEmbed(embed)) return false;
    const targetId = configService.getProctorChannelId();
    if (!targetId) return false;
    const target = client.channels.cache.get(targetId);
    if (!target || !target.isTextBased()) return false;
    const opt: any = { embeds: [embed] };
    if (message.content) opt.content = message.content;
    await (target as any).send(opt);
    try { await message.react('✅'); } catch {}
    logger.info('Proctor', `ส่งต่อ Proctor ข้อความ ${message.id}`);
    return true;
}

export function setupProctorFeature(client: Client): void {
    client.on(Events.MessageCreate, async (message) => {
        try {
            const logCaseId = configService.getLogCaseChannelId();
            if (!logCaseId || message.channel.id !== logCaseId || !message.webhookId) return;
            const embed = message.embeds?.[0];
            if (!isProctorEmbed(embed)) return;
            const hasCheck = message.reactions.cache.some((r: any) => r.emoji.name === '✅' && r.users.cache.has(client.user?.id || ''));
            if (hasCheck) return;
            await forwardProctorMessage(message, client);
        } catch (e) { logger.error('Proctor', `ผิดพลาด: ${e}`); }
    });
}