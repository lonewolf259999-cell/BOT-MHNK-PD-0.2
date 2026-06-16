import { Client, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { configService } from '../../core/config.service';
import { sheetService } from '../../core/sheet.service';
import { registerMember, moveMemberToOut, checkPreApproved, checkInOutDc, isAlreadyRegistered } from './welcome.service';
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
 * สร้าง embed 🎉 ยินดีต้อนรับ (ส่งไป Welcome Channel)
 */
function buildWelcomeEmbed(userId: string, displayAvatarUrl: string, nickname: string, memberCount: number) {
    const embed = new EmbedBuilder()
        .setColor('#3aca1d')
        .setTitle('🎉 ยินดีต้อนรับสู่ Mahanakorn Diwa!')
        .setDescription(`ยินดีต้อนรับ <@${userId}> สู่ Mahanakorn Diwa!\n📛 **ชื่อในระบบ:** \`${nickname}\``)
        .setThumbnail(displayAvatarUrl)
        .addFields(
            { name: '👤 สมาชิก', value: `<@${userId}>`, inline: true },
            { name: '👥 สมาชิกรวม', value: `${memberCount} คน`, inline: true }
        )
        .setFooter({ text: 'MHNK Police Department • ยินดีต้อนรับ' })
        .setTimestamp();
    return embed;
}

export function setupWelcomeFeature(client: Client): void {
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const chId = configService.getWelcomeChannelId();
            if (!chId) return;
            const ch = member.guild.channels.cache.get(chId);
            if (!ch || !ch.isTextBased()) return;

            const isOutDc = await checkInOutDc(member.user.id);
            if (isOutDc) {
                await ch.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#808080')
                        .setTitle('ℹ️ ยินดีต้อนรับอีกครั้ง')
                        .setDescription(`<@${member.user.id}> ยินดีต้อนรับสู่ Mahanakorn Diwa!\n⚠️ **คุณมีชื่อในระบบที่ถูกถอดออกแล้ว** กรุณาติดต่อ Admin หากต้องการกลับเข้ามาทำงาน`)
                        .setThumbnail(member.user.displayAvatarURL())
                        .addFields(
                            { name: '👤 สมาชิก', value: `<@${member.user.id}>`, inline: true },
                            { name: '👥 สมาชิกรวม', value: `${member.guild.memberCount} คน`, inline: true }
                        )
                        .setFooter({ text: `${client.user?.username} • อดีตตำรวจ` })
                        .setTimestamp()
                    ],
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

                    // ส่ง 🎉 ไป Welcome Channel
                    await ch.send({
                        embeds: [buildWelcomeEmbed(member.user.id, member.user.displayAvatarURL(), result.nickname, member.guild.memberCount)]
                    });

                    // ส่ง 📝 ไป Log Channel
                    const regEmbed = buildRegEmbed(
                        member.user.id,
                        preApproved.icName,
                        preApproved.icPhone || '',
                        preApproved.ocAge || '',
                        result.nickname,
                        nickChanged
                    );

                    const logChId = configService.getLogChannelId();
                    if (logChId) {
                        const logCh = member.guild.channels.cache.get(logChId);
                        if (logCh?.isTextBased()) {
                            await logCh.send({ content: `<@${member.user.id}>`, embeds: [regEmbed] });
                        }
                    }
                    logger.info('ต้อนรับ', `Auto-register Pre-approved: ${member.user.tag} (${result.nickname})`);
                } else {
                    await ch.send({
                        embeds: [new EmbedBuilder()
                            .setColor('#FFA500')
                            .setTitle('⚠️ ยินดีต้อนรับ — ไม่สามารถลงทะเบียนอัตโนมัติ')
                            .setDescription(`<@${member.user.id}> ยินดีต้อนรับสู่ Mahanakorn Diwa!\n❌ ไม่สามารถลงทะเบียนให้คุณได้ (อาจซ้ำหรือข้อมูลไม่ถูกต้อง) กรุณาติดต่อ Admin`)
                            .setThumbnail(member.user.displayAvatarURL())
                            .addFields(
                                { name: '👤 สมาชิก', value: `<@${member.user.id}>`, inline: true },
                                { name: '👥 สมาชิกรวม', value: `${member.guild.memberCount} คน`, inline: true }
                            )
                            .setFooter({ text: `${client.user?.username} • Auto Approve Failed` })
                            .setTimestamp()
                        ],
                        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                            new ButtonBuilder().setCustomId('btn_check_status').setLabel('🔍 ตรวจสอบสถานะ').setStyle(ButtonStyle.Secondary)
                        )]
                    });
                }
            } else {
                await ch.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#3aca1d')
                        .setTitle('🎉 ยินดีต้อนรับสู่ Mahanakorn Diwa!')
                        .setDescription(`ยินดีต้อนรับ <@${member.user.id}> สู่ Mahanakorn Diwa!\n📌 กรุณากรอกใบสมัครที่หน้าเว็บไซต์เพื่อสมัครเป็นตำรวจ\n💡 หากสมัครแล้ว กดปุ่มด้านล่างเพื่อตรวจสอบสถานะ`)
                        .setThumbnail(member.user.displayAvatarURL())
                        .addFields(
                            { name: '👤 สมาชิกใหม่', value: `<@${member.user.id}>`, inline: true },
                            { name: '👥 สมาชิกรวม', value: `${member.guild.memberCount} คน`, inline: true }
                        )
                        .setFooter({ text: `${client.user?.username} • วันนี้` })
                        .setTimestamp()
                    ],
                    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('btn_check_status').setLabel('🔍 ตรวจสอบสถานะ').setStyle(ButtonStyle.Secondary)
                    )]
                });
            }

            logger.info('ต้อนรับ', `ส่งข้อความต้อนรับให้ ${member.user.tag} (preApproved=${preApproved.approved})`);
        } catch (e) { logger.error('ต้อนรับ', `GuildMemberAdd error: ${e}`); }
    });

    client.on(Events.GuildMemberRemove, async (member) => {
        try {
            await moveMemberToOut(member.user.id);
            const chId = configService.getWelcomeChannelId();
            if (!chId) return;
            const ch = member.guild.channels.cache.get(chId);
            if (!ch || !ch.isTextBased()) return;
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
        } catch (e) { logger.error('ต้อนรับ', `GuildMemberRemove error: ${e}`); }
    });

    // ✅ ปุ่มตรวจสอบสถานะ
    client.on(Events.InteractionCreate, async (i: any) => {
        try {
            if (!i.isButton || i.customId !== 'btn_check_status') return;
            await i.deferReply({ flags: MessageFlags.Ephemeral });

            const userId = i.user.id;
            const member = i.guild?.members.cache.get(userId);

            const isOutDc = await checkInOutDc(userId);
            if (isOutDc) {
                await i.editReply({ content: 'ℹ️ คุณมีชื่อในระบบที่ถูกถอดออกแล้ว กรุณาติดต่อ Admin หากต้องการกลับเข้ามาทำงาน' });
                return;
            }

            const preApproved = await checkPreApproved(userId);
            if (preApproved.approved && preApproved.icName) {
                await i.editReply({ content: '✅ พบการอนุมัติ! กำลังลงทะเบียนให้...' });
                const result = await registerMember(preApproved.icName, userId);
                if (result) {
                    let nickChanged = true;
                    if (member) { try { await member.setNickname(result.nickname); } catch { nickChanged = false; } }

                    await i.editReply({ content: `✅ ลงทะเบียนสำเร็จ!\n📛 **ชื่อในระบบ:** ${result.nickname}` });

                    // ส่ง 📝 ไป Log Channel
                    const regEmbed = buildRegEmbed(
                        userId,
                        preApproved.icName,
                        preApproved.icPhone || '',
                        preApproved.ocAge || '',
                        result.nickname,
                        nickChanged
                    );

                    const logChId = configService.getLogChannelId();
                    if (logChId) {
                        const logCh = i.guild?.channels.cache.get(logChId);
                        if (logCh?.isTextBased()) {
                            await logCh.send({ content: `<@${userId}>`, embeds: [regEmbed] });
                        }
                    }
                } else {
                    await i.editReply({ content: '❌ ไม่สามารถลงทะเบียนได้ (อาจซ้ำหรือข้อมูลไม่ถูกต้อง) กรุณาติดต่อ Admin' });
                }
                return;
            }

            const pendingInfo = await checkPendingStatus(userId);
            if (pendingInfo.found) {
                await i.editReply({ content: `📋 ใบสมัครของคุณ **${pendingInfo.status}** อยู่ในระบบแล้ว\n${pendingInfo.status === 'รอตรวจ' ? '⏳ กรุณารอ Admin ตรวจสอบ' : ''}` });
                return;
            }

            const alreadyReg = await isAlreadyRegistered(userId);
            if (alreadyReg) {
                await i.editReply({ content: '✅ คุณมีชื่อในระบบตำรวจอยู่แล้ว ไม่ต้องสมัครซ้ำ' });
                return;
            }

            await i.editReply({ content: '📝 ยังไม่พบข้อมูลของคุณ กรุณากรอกใบสมัครที่หน้าเว็บไซต์ https://mhnk-pd-0-1.onrender.com/register' });
        } catch (e) { logger.error('ต้อนรับ', `Check status button error: ${e}`); }
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