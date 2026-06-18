import { Client, Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, EmbedBuilder, ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { configService } from '../../core/config.service';
import { findMemberByDiscordId, updateMemberName } from '../welcome/welcome.service';
import { truncateNickname } from '../../services/member.service';
import { logger } from '../../core/logger';
import { silentCatch } from '../../services/utils';

export function setupEditPdFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i) => {
        if (i.isChatInputCommand() && i.commandName === 'editpd') {
            const cmd = i as ChatInputCommandInteraction<'cached'>;
            await cmd.showModal(
                new ModalBuilder().setCustomId('modal_edit_pd').setTitle('📝 แก้ไขโปรไฟล์ตำรวจ')
                    .addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder().setCustomId('input_ic_name').setLabel('ชื่อ IC ใหม่').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกชื่อ IC ใหม่ (ถ้าไม่เปลี่ยนปล่อยว่าง)').setRequired(false).setMaxLength(100),
                        ),
                    )
                    .addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder().setCustomId('input_ic_phone').setLabel('เบอร์โทร IC ใหม่').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกเบอร์โทรใหม่ (ถ้าไม่เปลี่ยนปล่อยว่าง)').setRequired(false).setMaxLength(20),
                        ),
                    )
                    .addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder().setCustomId('input_ooc_age').setLabel('อายุ OOC ใหม่').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกอายุใหม่ (ถ้าไม่เปลี่ยนปล่อยว่าง)').setRequired(false).setMaxLength(3),
                        ),
                    ),
            ).catch(silentCatch('EditPD'));
            return;
        }
        if (i.isModalSubmit() && i.customId === 'modal_edit_pd') {
            const modal = i as ModalSubmitInteraction<'cached'>;
            await modal.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const newName = modal.fields.getTextInputValue('input_ic_name').trim();
                const newPhone = modal.fields.getTextInputValue('input_ic_phone').trim();
                const newAge = modal.fields.getTextInputValue('input_ooc_age').trim();
                const uid = modal.user.id;
                const changed: string[] = [];
                const logChId = configService.getLogChannelId();
                if (!logChId) {
                    await modal.editReply({ content: '❌ ไม่ได้ตั้งค่า Log channel' });
                    return;
                }
                const logCh = modal.guild.channels.cache.get(logChId);
                if (!logCh || !logCh.isTextBased()) {
                    await modal.editReply({ content: '❌ ไม่พบ Log channel' });
                    return;
                }
                const msgs = await logCh.messages.fetch({ limit: 100 });
                let embedMsg: import('discord.js').Message | null = null;
                for (const msg of msgs.values()) {
                    if (msg.embeds.length > 0) {
                        const f = msg.embeds[0].fields?.find((x: { name: string; value: string }) => x.name.includes('Discord ID'));
                        if (f && f.value.replace(/`/g, '').trim() === uid) embedMsg = msg;
                    }
                }
                if (!embedMsg) {
                    await modal.editReply({ content: '❌ ไม่พบประวัติการลงทะเบียน' });
                    return;
                }
                let info: { row: number; codeNumber: string; currentName: string } | null = null;
                if (newName) {
                    info = await findMemberByDiscordId(uid);
                    if (info) {
                        const full = `${info.codeNumber} [MHNK-PD] ${newName}`;
                        await updateMemberName(info.row, full);
                        try { await modal.member.setNickname(truncateNickname(full)); } catch { /* ignore */ }
                        changed.push(`ชื่อ IC → **${newName}**`);
                    }
                }
                let e = EmbedBuilder.from(embedMsg.embeds[0]);
                if (newName) {
                    e = e.spliceFields(1, 1, { name: '📛 ชื่อ IC', value: newName, inline: true });
                    if (info) {
                        const full = `${info.codeNumber} [MHNK-PD] ${newName}`;
                        e = e.spliceFields(2, 1, { name: '⚙️ ชื่อในระบบ (คัดลอกไปวางที่ Fivem ใน ⚙️Setting > Player Name ก่อนเข้าประเทศ)', value: `\`${truncateNickname(full)}\``, inline: false });
                    }
                }
                if (newPhone) {
                    e = e.spliceFields(3, 1, { name: '📞 เบอร์โทร IC', value: newPhone, inline: true });
                    changed.push(`เบอร์โทร → **${newPhone}**`);
                }
                if (newAge) {
                    e = e.spliceFields(4, 1, { name: '🎂 อายุ OOC', value: `${newAge} ปี`, inline: true });
                    changed.push(`อายุ → **${newAge}**`);
                }
                await embedMsg.edit({ embeds: [e] });
                if (changed.length === 0) {
                    await modal.editReply({ content: '⚠️ ไม่มีการเปลี่ยนแปลง' });
                    return;
                }
                await modal.editReply({ content: '✅ อัปเดตสำเร็จ!\n' + changed.join('\n') });
            } catch (e: unknown) {
                logger.error('แก้PD', `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
                await modal.editReply({ content: '❌ เกิดข้อผิดพลาด' });
            }
        }
    });
}