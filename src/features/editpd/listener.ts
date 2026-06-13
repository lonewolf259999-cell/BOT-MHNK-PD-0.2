import { Client, Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { configService } from '../../core/config.service';
import { findMemberByDiscordId, updateMemberName } from '../welcome/welcome.service';
import { truncateNickname } from '../../services/member.service';
import { logger } from '../../core/logger';
import { silentCatch } from '../../services/utils';

export function setupEditPdFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i: any) => {
        if (i.isChatInputCommand && i.commandName === 'editpd') {
            return i.showModal(new ModalBuilder().setCustomId('modal_edit_pd').setTitle('📝 แก้ไขโปรไฟล์ตำรวจ')
                .addComponents(new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId('input_ic_name').setLabel('ชื่อ IC ใหม่').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกชื่อ IC ใหม่ (ถ้าไม่เปลี่ยนปล่อยว่าง)').setRequired(false).setMaxLength(100)))
                .addComponents(new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId('input_ic_phone').setLabel('เบอร์โทร IC ใหม่').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกเบอร์โทรใหม่ (ถ้าไม่เปลี่ยนปล่อยว่าง)').setRequired(false).setMaxLength(20)))
                .addComponents(new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId('input_ooc_age').setLabel('อายุ OOC ใหม่').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกอายุใหม่ (ถ้าไม่เปลี่ยนปล่อยว่าง)').setRequired(false).setMaxLength(3)))
            ).catch(silentCatch('EditPD'));
        }
        if (i.isModalSubmit && i.customId === 'modal_edit_pd') {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const newName = i.fields.getTextInputValue('input_ic_name').trim();
                const newPhone = i.fields.getTextInputValue('input_ic_phone').trim();
                const newAge = i.fields.getTextInputValue('input_ooc_age').trim();
                const uid = i.user.id, changed: string[] = [];
                const logChId = configService.getLogChannelId();
                if (!logChId) return i.editReply({ content: '❌ ไม่ได้ตั้งค่า Log channel' });
                const logCh = i.guild.channels.cache.get(logChId);
                if (!logCh) return i.editReply({ content: '❌ ไม่พบ Log channel' });
                const msgs = await logCh.messages.fetch({ limit: 100 });
                let embedMsg: any = null;
                for (const msg of msgs.values()) {
                    if (msg.embeds.length > 0) { const f = msg.embeds[0].fields?.find((x: any) => x.name.includes('Discord ID')); if (f && f.value.replace(/`/g, '').trim() === uid) embedMsg = msg; }
                }
                if (!embedMsg) return i.editReply({ content: '❌ ไม่พบประวัติการลงทะเบียน' });
                if (newName) {
                    const info = await findMemberByDiscordId(uid);
                    if (info) {
                        const full = `${info.codeNumber} [MHNK-PD] ${newName}`;
                        await updateMemberName(info.row, full);
                        try { await i.member.setNickname(truncateNickname(full)); } catch {}
                        changed.push(`ชื่อ IC → **${newName}**`);
                    }
                }
                let e = EmbedBuilder.from(embedMsg.embeds[0]);
                if (newName) { e = e.spliceFields(1, 1, { name: '📛 ชื่อ IC', value: newName, inline: true }); const info = await findMemberByDiscordId(uid).catch(() => null); if (info) { const full = `${info.codeNumber} [MHNK-PD] ${newName}`; e = e.spliceFields(2, 1, { name: '⚙️ ชื่อในระบบ (คัดลอกไปวางที่ Fivem ใน ⚙️Setting > Player Name ก่อนเข้าประเทศ)', value: `\`${truncateNickname(full)}\``, inline: false }); } }
                if (newPhone) { e = e.spliceFields(3, 1, { name: '📞 เบอร์โทร IC', value: newPhone, inline: true }); changed.push(`เบอร์โทร → **${newPhone}**`); }
                if (newAge) { e = e.spliceFields(4, 1, { name: '🎂 อายุ OOC', value: `${newAge} ปี`, inline: true }); changed.push(`อายุ → **${newAge}**`); }
                await embedMsg.edit({ embeds: [e] });
                if (changed.length === 0) return i.editReply({ content: '⚠️ ไม่มีการเปลี่ยนแปลง' });
                await i.editReply({ content: '✅ อัปเดตสำเร็จ!\n' + changed.join('\n') });
            } catch (e) { logger.error('แก้PD', `ผิดพลาด: ${e}`); await i.editReply({ content: '❌ เกิดข้อผิดพลาด' }); }
        }
    });
}