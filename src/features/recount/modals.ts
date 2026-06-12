import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { configService } from '../../core/config.service';

function createModal(customId: string, title: string, fields: [string, string, string, boolean?][]): ModalBuilder {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
    for (const [id, label, value, isParagraph] of fields) {
        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(id).setLabel(label)
                    .setStyle(isParagraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
                    .setValue(value || '').setRequired(true)
            )
        );
    }
    return modal;
}

export function buildCountModal(): ModalBuilder {
    const cfg = configService.getCountConfig();
    const channels = [1, 2, 3, 4, 5].map(i => cfg.CHANNELS[`CHANNEL_${i}` as keyof typeof cfg.CHANNELS]).join(',');
    return createModal('modal_cfg_count', 'ตั้งค่า — นับเคส', [
        ['input_spreadsheet_id', 'Spreadsheet ID', cfg.SPREADSHEET_ID],
        ['input_sheet_name', 'Sheet Name', cfg.SHEET_NAME],
        ['input_all_channels', 'CH1,CH2,CH3,CH4,CH5 (คั่น ,)', channels, true],
    ]);
}

export function buildWelcomeModal(): ModalBuilder {
    return createModal('modal_cfg_welcome', 'ตั้งค่า — ต้อนรับ / ลงทะเบียน', [
        ['input_welcome_channel', 'WELCOME_CHANNEL_ID', configService.getWelcomeChannelId()],
        ['input_log_channel', 'LOG_CHANNEL_ID', configService.getLogChannelId()],
        ['input_logtime_channel', 'LOGTIME_CHANNEL_ID', configService.getLogtimeChannelId()],
    ]);
}

export function buildBypdModal(): ModalBuilder {
    return createModal('modal_cfg_bypd', 'ตั้งค่า — BYPD + Proctor + LogCase', [
        ['input_logcase_channel', 'LOGCASE_CHANNEL_ID', configService.getLogCaseChannelId()],
        ['input_bypd_send', 'BYPD_SEND_CHANNEL_ID', configService.getBypdSendChannelId()],
        ['input_proctor_channel', 'PROCTOR_CHANNEL_ID', configService.getProctorChannelId()],
    ]);
}

export function buildRegistryModal(): ModalBuilder {
    const reg = configService.getRegistryConfig();
    return createModal('modal_cfg_registry', 'ตั้งค่า — ชีตลงทะเบียน PD', [
        ['input_registry_sheet_id', 'REGISTRY_SPREADSHEET_ID', reg.spreadsheetId],
        ['input_registry_sheet_name', 'REGISTRY_SHEET_NAME', reg.sheetName],
        ['input_registry_out_sheet', 'REGISTRY_OUT_SHEET_NAME', reg.outSheetName],
    ]);
}