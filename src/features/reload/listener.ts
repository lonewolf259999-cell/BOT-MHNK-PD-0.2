import { Client, Events, MessageFlags } from 'discord.js';
import { configService } from '../../core/config.service';
import { rateLimiter } from '../../core/ratelimiter';
import { logger } from '../../core/logger';

export function setupReloadFeature(client: Client): void {
    // คำสั่ง /reload ถูกลงทะเบียนผ่าน Bulk Registration ที่ index.ts แล้ว
    // ที่นี่จัดการเฉพาะ Interaction (การทำงานเมื่อผู้ใช้ใช้งานคำสั่ง)

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