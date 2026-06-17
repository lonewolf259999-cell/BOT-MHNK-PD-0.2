import { Client, Events, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { configService } from '../../core/config.service';
import { rateLimiter } from '../../core/ratelimiter';
import { logger } from '../../core/logger';

export function setupReloadFeature(client: Client): void {
    client.once(Events.ClientReady, async () => {
        const cmd = new SlashCommandBuilder().setName('reload').setDescription('🔄 รีโหลด config จาก Google Sheet').setDefaultMemberPermissions(0);
        try {
            const existing = await client.application?.commands.fetch();
            const old = existing?.find(c => c.name === 'reload');
            if (old) await client.application?.commands.edit(old.id, cmd);
            else await client.application?.commands.create(cmd);
            logger.info('รีโหลด', 'ลงทะเบียนคำสั่ง /reload สำเร็จ');
        } catch (e) { logger.error('รีโหลด', `ลงทะเบียนล้มเหลว: ${e}`); }
    });

    client.on(Events.InteractionCreate, async (i: any) => {
        if (!i.isChatInputCommand || i.commandName !== 'reload') return;
        if (!i.memberPermissions?.has('Administrator')) return i.reply({ content: '❌ เฉพาะผู้ดูแลระบบเท่านั้น', flags: MessageFlags.Ephemeral });

        if (!rateLimiter.check(`reload:${i.user.id}`, 1, 30000)) { const s = 30; return i.reply({ content: `⏳ กรุณารอ **${s}** วินาที`, flags: MessageFlags.Ephemeral }); }
        await i.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await configService.reload();
            await i.editReply({ embeds: [{ color: 0x00c400, title: '✅ Config Reload สำเร็จ', description: 'Config ถูกโหลดใหม่จาก Google Sheet เรียบร้อยแล้ว', fields: [{ name: '📊 Count Config', value: configService.isLoaded() ? '✅ พร้อมใช้งาน' : '❌ ไม่พร้อม', inline: true }, { name: '📋 Registry Config', value: configService.getRegistryConfig().spreadsheetId ? '✅ พร้อมใช้งาน' : '❌ ไม่พร้อม', inline: true }, { name: '👋 Welcome Channel', value: configService.getWelcomeChannelId() ? `✅ \`${configService.getWelcomeChannelId()}\`` : '❌ ไม่ตั้งค่า', inline: false }], timestamp: new Date().toISOString(), footer: { text: `โดย ${i.user.tag}` } }] });
            logger.info('รีโหลด', `Config รีโหลดโดย ${i.user.tag}`);
        } catch (err: any) {
            await i.editReply({ embeds: [{ color: 0xff4444, title: '❌ Config Reload ล้มเหลว', description: `\`\`\`${err.message}\`\`\``, timestamp: new Date().toISOString() }] });
        }
    });
}