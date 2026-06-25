import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { configService } from '../../core/config.service';
import { resendStates } from './resend.state';

export function createPanelEmbed(): EmbedBuilder {
    const count = configService.getCountConfig();
    const reg = configService.getRegistryConfig();
    const chs = count.CHANNELS;
    const ch = (id: string) => id ? `<#${id}>` : '`ยังไม่ระบุ`';

    return new EmbedBuilder()
        .setColor('#f4c430')
        .setTitle('⚙️ แผงควบคุม Mahanakorn Bot')
        .setDescription(
            '**นับเคส**\n' +
            `• Sheet ID: \`${count.SPREADSHEET_ID || 'ยังไม่ตั้ง'}\`\n` +
            `• Sheet Name: \`${count.SHEET_NAME || 'ยังไม่ตั้ง'}\`\n` +
            `• Take 2 (C): ${ch(chs.CHANNEL_1)} | คดีปกติ (D): ${ch(chs.CHANNEL_2)}\n` +
            `• รถยอด (E): ${ch(chs.CHANNEL_3)} | คุมสอบ (F): ${ch(chs.CHANNEL_4)} | อุ้มเอ๋อ (G): ${ch(chs.CHANNEL_5)}\n\n` +
            '**ต้อนรับ / ลงทะเบียน**\n' +
            `• Welcome: ${ch(configService.getWelcomeChannelId())}\n` +
            `• Log ลงทะเบียน: ${ch(configService.getLogChannelId())}\n` +
            `• Log เวร: ${ch(configService.getLogtimeChannelId())}\n\n` +
            '**BYPD / Proctor / LogCase**\n' +
            `• LogCase: ${ch(configService.getLogCaseChannelId())}\n` +
            `• ส่ง BYPD: ${ch(configService.getBypdSendChannelId())}\n` +
            `• ส่ง Proctor: ${ch(configService.getProctorSendChannelId())}\n\n` +
            '**ชีตลงทะเบียน PD**\n' +
            `• ID: \`${reg.spreadsheetId}\`\n` +
            `• แท็บ: \`${reg.sheetName}\` | ออก: \`${reg.outSheetName}\``
        )
        .setFooter({ text: 'กดปุ่มด้านล่างเพื่อตั้งค่าหรือเริ่มนับข้อความเก่า' });
}

export function buildPanelComponents(): ActionRowBuilder<ButtonBuilder>[] {
    // Use a generic guildId for resend state tracking
    const running = resendStates.isRunning('global');

    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('btn_recount_manual').setLabel('⭐ เริ่มนับข้อความเก่า').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_cfg_count').setLabel('📊 ตั้งค่า — นับเคส').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cfg_welcome').setLabel('🚪 ตั้งค่า — ต้อนรับ').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('btn_cfg_bypd').setLabel('🆔 ตั้งค่า — ระบบคดี').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cfg_registry').setLabel('📋 ตั้งค่า — ชีต PD').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_refresh_config').setLabel('🔄 รีเฟรช config').setStyle(ButtonStyle.Success),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_resend_bypd')
                .setLabel(running ? '⏹️ หยุดทำงาน' : '🔄 ส่งย้อนหลัง BYPD')
                .setStyle(running ? ButtonStyle.Danger : ButtonStyle.Primary)
        ),
    ];
}