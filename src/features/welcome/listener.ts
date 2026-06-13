import { Client, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { silentCatch } from '../../services/utils';
import { configService } from '../../core/config.service';
import { isAlreadyRegistered, registerMember, moveMemberToOut } from './welcome.service';
import { logger } from '../../core/logger';

const RATE_LIMIT = new Map<string, number>();
function checkRateLimit(userId: string): number {
    const now = Date.now(); const last = RATE_LIMIT.get(userId) || 0;
    if (now - last < 60000) return Math.ceil((60000 - (now - last)) / 1000);
    RATE_LIMIT.set(userId, now); return 0;
}

export function setupWelcomeFeature(client: Client): void {
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const chId = configService.getWelcomeChannelId();
            if (!chId) return;
            const ch = member.guild.channels.cache.get(chId);
            if (!ch || !ch.isTextBased()) return;
            await ch.send({
                embeds: [new EmbedBuilder().setColor('#3aca1d').setTitle('🎉 ยินดีต้อนรับสู่ Mahanakorn Diwa!').setDescription(`ยินดีต้อนรับ <@${member.user.id}> สู่ Mahanakorn Diwa!\n กดลงทะเบียนก่อนนะ 🎉`).setThumbnail(member.user.displayAvatarURL()).addFields({ name: '👤 สมาชิกใหม่', value: `<@${member.user.id}>`, inline: true }, { name: '👥 สมาชิกรวม', value: `${member.guild.memberCount} คน`, inline: true }).setFooter({ text: `${client.user?.username} • วันนี้` }).setTimestamp()],
                components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('btn_register').setLabel('กรอกชื่อ IC ตามบัตรในเมือง').setStyle(ButtonStyle.Success).setEmoji('📝'))]
            });
            logger.info('ต้อนรับ', `ส่งข้อความต้อนรับให้ ${member.user.tag}`);
        } catch (e) { logger.error('ต้อนรับ', `GuildMemberAdd error: ${e}`); }
    });

    client.on(Events.GuildMemberRemove, async (member) => {
        try {
            await moveMemberToOut(member.user.id);
            const chId = configService.getWelcomeChannelId();
            if (!chId) return;
            const ch = member.guild.channels.cache.get(chId);
            if (!ch || !ch.isTextBased()) return;
            await ch.send({ embeds: [new EmbedBuilder().setColor('#db0042').setTitle('😭 บ๊ายบาย แล้วพบกันใหม่').setDescription(`สมาชิก <@${member.user.id}> ได้ออกจากเซิร์ฟเวอร์`).setThumbnail(member.user.displayAvatarURL()).addFields({ name: '👤 ผู้จากไป', value: `<@${member.user.id}>`, inline: true }, { name: '👥 สมาชิกที่เหลือ', value: `${member.guild.memberCount} คน`, inline: true }).setFooter({ text: `${client.user?.username} • วันนี้` }).setTimestamp()] });
            logger.info('ต้อนรับ', `ส่งข้อความออกให้ ${member.user.tag}`);
        } catch (e) { logger.error('ต้อนรับ', `GuildMemberRemove error: ${e}`); }
    });

    client.on(Events.InteractionCreate, async (i: any) => {
        try {
            if (i.isButton && i.customId === 'btn_register') {
                const modal = new ModalBuilder().setCustomId('modal_register').setTitle('ฟอร์มลงทะเบียนข้อมูลตำรวจ')
                    .addComponents(new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId('input_ic_name').setLabel('ชื่อ IC ตามบัตรประชาชนในประเทศ').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกชื่อในเกมของคุณเป็นภาษาอังกฤษ').setRequired(true)))
                    .addComponents(new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId('input_ic_phone').setLabel('เบอร์โทร IC').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกเบอร์โทรศัพท์ในเกม').setRequired(true)))
                    .addComponents(new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId('input_ooc_age').setLabel('อายุ OOC (ชีวิตจริง)').setStyle(TextInputStyle.Short).setPlaceholder('กรุณากรอกอายุจริงของคุณ').setRequired(true)));
                return await i.showModal(modal).catch(silentCatch('Welcome'));
            }

            if (i.isModalSubmit && i.customId === 'modal_register') {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const sec = checkRateLimit(i.user.id);
                if (sec > 0) return await i.editReply({ content: `⏳ กรุณารอ **${sec}** วินาที ก่อนลงทะเบียนใหม่` });
                if (await isAlreadyRegistered(i.user.id)) return await i.editReply({ content: '❌ คุณลงทะเบียนไปแล้ว ไม่สามารถลงทะเบียนซ้ำได้ครับ!' });

                const icName = i.fields.getTextInputValue('input_ic_name').trim();
                const icPhone = i.fields.getTextInputValue('input_ic_phone').trim();
                const oocAge = i.fields.getTextInputValue('input_ooc_age').trim();
                const result = await registerMember(icName, i.user.id);
                if (!result) return await i.editReply({ content: '❌ เกิดข้อผิดพลาด: ไม่พบแถวว่างในตาราง Google Sheets' });

                let nickChanged = true;
                try { await i.member.setNickname(result.nickname); } catch { nickChanged = false; }

                const logChId = configService.getLogChannelId();
                if (logChId) {
                    const logCh = i.guild?.channels.cache.get(logChId);
                    if (logCh?.isTextBased()) {
                        await logCh.send({ content: `<@${i.user.id}>`, embeds: [new EmbedBuilder().setColor('#a0c400').setTitle('📝 มีการลงทะเบียนใหม่ผ่านระบบสำเร็จ').setDescription(`ผู้ใช้งาน <@${i.user.id}> ลงทะเบียนเข้าสู่ระบบสำเร็จแล้ว`).addFields({ name: '🆔 Discord ID', value: `\`${i.user.id}\``, inline: true }, { name: '📛 ชื่อ IC', value: icName, inline: true }, { name: '⚙️ ชื่อในระบบ (คัดลอกไปวางที่ Fivem ใน ⚙️Setting > Player Name ก่อนเข้าประเทศ)', value: `\`${result.nickname}\``, inline: false }, { name: '📞 เบอร์โทร IC', value: icPhone, inline: true }, { name: '🎂 อายุ OOC', value: `${oocAge} ปี`, inline: true }, { name: '🏷️ ตำแหน่ง', value: 'นักเรียนตำรวจ', inline: true }, { name: '📱 สถานะการเปลี่ยนชื่อดิส', value: nickChanged ? '✅ สำเร็จ' : '❌ ล้มเหลว', inline: true }).setTimestamp()] });
                    }
                }

                let msg = `✅ ลงทะเบียนเรียบร้อยแล้ว!\n📝 **ชื่อในชีต:** ${result.nickname}\n🔄 **ชื่อ Discord:** ${result.nickname}`;
                if (result.wasTruncated) msg += '\n⚠️ *(ชื่อ IC ของคุณยาวเกินไป Discord จึงย่อชื่อให้สั้นลง)*';
                if (!nickChanged) msg += '\n⚠️ *(หมายเหตุ: บอทไม่มีสิทธิ์เปลี่ยนชื่อเล่นให้คุณ)*';
                await i.editReply({ content: msg });
                logger.info('ต้อนรับ', `ผู้ใช้ ${i.user.tag} ลงทะเบียนสำเร็จ`);
            }
        } catch (e) { logger.error('ต้อนรับ', `Interaction error: ${e}`); }
    });
}