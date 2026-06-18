import { Client, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ColorResolvable, Interaction, ButtonInteraction } from 'discord.js';
import { configService } from '../../core/config.service';
import { sheetService } from '../../core/sheet.service';
import { registerMember, moveMemberToOut, checkPreApproved, checkInOutDc, isAlreadyRegistered } from './welcome.service';
import { getTextChannel } from '../../services/utils';
import { logger } from '../../core/logger';

/**
 * สร้าง embed 📝 แบบเดียวกันสำหรับทุกกรณีที่ลงทะเบียนสำเร็จ (ส่งไป Log)
 */
function buildRegEmbed(userId: string, icName: string, icPhone: string, ocAge: string, nickname: string, nickChanged: boolean) {
    return new EmbedBuilder()
        .setColor('#a0c400')
        .setTitle('📝 มีการลงทะเบียนใหม่ผ่านระบบสำเร็จ')
        .setDescription(`ผู้ใช้งาน <@${userId}> ลงทะเบียนเข้าสู่ระบบสำเร็จแล้ว`)
        .addFields(
            { name: '🆔 Discord ID', value: `\`${userId}\``, inline: true },
            { name: '📛 ชื่อ IC', value: icName, inline: true },
            { name: '⚙️ ชื่อในระบบ (คัดลอกไปวางที่ Fivem ใน ⚙️Setting > Player Name ก่อนเข้าประเทศ)', value: `\`${nickname}\``, inline: false },
            { name: '📞 เบอร์ IC', value: icPhone || '—', inline: true },
            { name: '🎂 อายุ OOC', value: ocAge || '—', inline: true },
            { name: '🏷️ ตำแหน่ง', value: 'นักเรียนตำรวจ', inline: true },
            { name: '📱 สถานะการเปลี่ยนชื่อดิส', value: nickChanged ? '✅ สำเร็จ' : '❌ ล้มเหลว', inline: true }
        )
        .setTimestamp();
}

/**
 * สร้าง embed ต้อนรับแบบทั่วไป (ใช้แทนการสร้าง EmbedBuilder ซ้ำ 3 แบบ)
 */
function buildWelcomeEmbedV2(color: ColorResolvable, title: string, description: string, userId: string, avatar: string, memberCount: number, footer: string, isNewMember = false) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setThumbnail(avatar)
        .addFields(
            { name: isNewMember ? '👤 สมาชิกใหม่' : '👤 สมาชิก', value: `<@${userId}>`, inline: true },
            { name: '👥 สมาชิกรวม', value: `${memberCount} คน`, inline: true }
        )
        .setFooter({ text: footer })
        .setTimestamp();
}

export function setupWelcomeFeature(client: Client): void {
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const ch = getTextChannel(member.guild, configService.getWelcomeChannelId());
            if (!ch) return;

            const isOutDc = await checkInOutDc(member.user.id);
            if (isOutDc) {
                await ch.send({
                    embeds: [buildWelcomeEmbedV2(
                        '#808080',
                        'ℹ️ ยินดีต้อนรับอีกครั้ง',
                        `<@${member.user.id}> ยินดีต้อนรับสู่ Mahanakorn Diwa!\n⚠️ **คุณมีชื่อในระบบที่ถูกถอดออกแล้ว** กรุณาติดต่อ Admin หากต้องการกลับเข้ามาทำงาน`,
                        member.user.id,
                        member.user.displayAvatarURL(),
                        member.guild.memberCount,
                        `${client.user?.username} • อดีตตำรวจ`
                    )],
                    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('btn_check_status').setLabel('🔍 ตรวจสอบสถานะ').setStyle(ButtonStyle.Secondary)
                    )]
                });
                logger.info('ต้อนรับ', `OutDC rejoin: ${member.user.tag}`);
                return;
            }

            const preApproved = await checkPreApproved(member.user.id);
            if (preApproved.approved && preApproved.icName) {
                const result = await registerMember(preApproved.icName, member.user.id);
                if (result) {
                    let nickChanged = true;
                    try { await member.setNickname(result.nickname); } catch { nickChanged = false; }

                    await ch.send({
                        embeds: [buildWelcomeEmbedV2(
                            '#3aca1d',
                            '🎉 ยินดีต้อนรับสู่ Mahanakorn Diwa!',
                            `ยินดีต้อนรับ <@${member.user.id}> สู่ Mahanakorn Diwa!\n📛 **ชื่อในระบบ:** \`${result.nickname}\``,
                            member.user.id,
                            member.user.displayAvatarURL(),
                            member.guild.memberCount,
                            'MHNK Police Department • ยินดีต้อนรับ'
                        )]
                    });

                    const regEmbed = buildRegEmbed(
                        member.user.id,
                        preApproved.icName,
                        preApproved.icPhone || '',
                        preApproved.ocAge || '',
                        result.nickname,
                        nickChanged
                    );

                    const logCh = getTextChannel(member.guild, configService.getLogChannelId());
                    if (logCh) {
                        await logCh.send({ content: `<@${member.user.id}>`, embeds: [regEmbed] });
                    }
                    logger.info('ต้อนรับ', `Auto-register Pre-approved: ${member.user.tag} (${result.nickname})`);
                } else {
                    await ch.send({
                        embeds: [buildWelcomeEmbedV2(
                            '#FFA500',
                            '⚠️ ยินดีต้อนรับ — ไม่สามารถลงทะเบียนอัตโนมัติ',
                            `<@${member.user.id}> ยินดีต้อนรับสู่ Mahanakorn Diwa!\n❌ ไม่สามารถลงทะเบียนให้คุณได้ (อาจซ้ำหรือข้อมูลไม่ถูกต้อง) กรุณาติดต่อ Admin`,
                            member.user.id,
                            member.user.displayAvatarURL(),
                            member.guild.memberCount,
                            `${client.user?.username} • Auto Approve Failed`
                        )],
                        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                            new ButtonBuilder().setCustomId('btn_check_status').setLabel('🔍 ตรวจสอบสถานะ').setStyle(ButtonStyle.Secondary)
                        )]
                    });
                }
            } else {
                await ch.send({
                    embeds: [buildWelcomeEmbedV2(
                        '#3aca1d',
                        '🎉 ยินดีต้อนรับสู่ Mahanakorn Diwa!',
                        `ยินดีต้อนรับ <@${member.user.id}> สู่ Mahanakorn Diwa!\n📌 กรุณากรอกใบสมัครที่หน้าเว็บไซต์เพื่อสมัครเป็นตำรวจ\n💡 หากสมัครแล้ว กดปุ่มด้านล่างเพื่อตรวจสอบสถานะ`,
                        member.user.id,
                        member.user.displayAvatarURL(),
                        member.guild.memberCount,
                        `${client.user?.username} • วันนี้`,
                        true
                    )],
                    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('btn_check_status').setLabel('🔍 ตรวจสอบสถานะ').setStyle(ButtonStyle.Secondary)
                    )]
                });
            }

            logger.info('ต้อนรับ', `ส่งข้อความต้อนรับให้ ${member.user.tag} (preApproved=${preApproved.approved})`);
        } catch (e: unknown) {
            logger.error('ต้อนรับ', `GuildMemberAdd error: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    client.on(Events.GuildMemberRemove, async (member) => {
        try {
            await moveMemberToOut(member.user.id);
            const ch = getTextChannel(member.guild, configService.getWelcomeChannelId());
            if (!ch) return;
            await ch.send({
                embeds: [new EmbedBuilder()
                    .setColor('#db0042')
                    .setTitle('😭 บ๊ายบาย แล้วพบกันใหม่')
                    .setDescription(`สมาชิก <@${member.user.id}> ได้ออกจากเซิร์ฟเวอร์`)
                    .setThumbnail(member.user.displayAvatarURL())
                    .addFields(
                        { name: '👤 ผู้จากไป', value: `<@${member.user.id}>`, inline: true },
                        { name: '👥 สมาชิกที่เหลือ', value: `${member.guild.memberCount} คน`, inline: true }
                    )
                    .setFooter({ text: `${client.user?.username} • วันนี้` })
                    .setTimestamp()
                ]
            });
            logger.info('ต้อนรับ', `ส่งข้อความออกให้ ${member.user.tag}`);
        } catch (e: unknown) {
            logger.error('ต้อนรับ', `GuildMemberRemove error: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    // ✅ ปุ่มตรวจสอบสถานะ
    client.on(Events.InteractionCreate, async (i: Interaction) => {
        try {
            if (!i.isButton() || i.customId !== 'btn_check_status') return;
            const btn = i as ButtonInteraction<'cached'>;
            await btn.deferReply({ flags: MessageFlags.Ephemeral });

            const userId = btn.user.id;
            const member = btn.guild?.members.cache.get(userId);

            const isOutDc = await checkInOutDc(userId);
            if (isOutDc) {
                await btn.editReply({ content: 'ℹ️ คุณมีชื่อในระบบที่ถูกถอดออกแล้ว กรุณาติดต่อ Admin หากต้องการกลับเข้ามาทำงาน' });
                return;
            }

            const preApproved = await checkPreApproved(userId);
            if (preApproved.approved && preApproved.icName) {
                await btn.editReply({ content: '✅ พบการอนุมัติ! กำลังลงทะเบียนให้...' });
                const result = await registerMember(preApproved.icName, userId);
                if (result) {
                    let nickChanged = true;
                    if (member) { try { await member.setNickname(result.nickname); } catch { nickChanged = false; } }

                    await btn.editReply({ content: `✅ ลงทะเบียนสำเร็จ!\n📛 **ชื่อในระบบ:** ${result.nickname}` });

                    const regEmbed = buildRegEmbed(
                        userId,
                        preApproved.icName,
                        preApproved.icPhone || '',
                        preApproved.ocAge || '',
                        result.nickname,
                        nickChanged
                    );

                    const logCh = getTextChannel(btn.guild, configService.getLogChannelId());
                    if (logCh) {
                        await logCh.send({ content: `<@${userId}>`, embeds: [regEmbed] });
                    }
                } else {
                    await btn.editReply({ content: '❌ ไม่สามารถลงทะเบียนได้ (อาจซ้ำหรือข้อมูลไม่ถูกต้อง) กรุณาติดต่อ Admin' });
                }
                return;
            }

            const pendingInfo = await checkPendingStatus(userId);
            if (pendingInfo.found) {
                await btn.editReply({ content: `📋 ใบสมัครของคุณ **${pendingInfo.status}** อยู่ในระบบแล้ว\n${pendingInfo.status === 'รอตรวจ' ? '⏳ กรุณารอ Admin ตรวจสอบ' : ''}` });
                return;
            }

            const alreadyReg = await isAlreadyRegistered(userId);
            if (alreadyReg) {
                await btn.editReply({ content: '✅ คุณมีชื่อในระบบตำรวจอยู่แล้ว ไม่ต้องสมัครซ้ำ' });
                return;
            }

            await btn.editReply({ content: '📝 ยังไม่พบข้อมูลของคุณ กรุณากรอกใบสมัครที่หน้าเว็บไซต์ https://mhnk-pd-0-1.onrender.com/register' });
        } catch (e: unknown) {
            logger.error('ต้อนรับ', `Check status button error: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}

async function checkPendingStatus(discordId: string): Promise<{ found: boolean; status?: string }> {
    try {
        const spreadsheetId = configService.getPendingSpreadsheetId();
        const sheetName = configService.getPendingSheetName();
        if (!spreadsheetId || !sheetName) return { found: false };

        const rows = await sheetService.getValues(spreadsheetId, `${sheetName}!A:H`, 0);
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const pendingId = (row[1] || '').trim();
            if (pendingId === discordId) {
                return { found: true, status: (row[7] || '').trim() };
            }
        }
        return { found: false };
    } catch {
        return { found: false };
    }
}