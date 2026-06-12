import { Client, Events, ContextMenuCommandBuilder, ApplicationCommandType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { findMembersByCode } from '../../services/member.service';
import { logger } from '../../core/logger';

const RATE_LIMIT = new Map<string, number>();

export function setupEditTagFeature(client: Client): void {
    client.once(Events.ClientReady, async () => {
        try {
            const existing = await client.application?.commands.fetch();
            if (!existing?.find(c => c.name === 'Edit Tags')) await client.application?.commands.create(new ContextMenuCommandBuilder().setName('Edit Tags').setType(ApplicationCommandType.Message));
            logger.info('แก้แท็ก', 'ลงทะเบียน Context Menu สำเร็จ');
        } catch (e) { logger.error('แก้แท็ก', `ลงทะเบียนล้มเหลว: ${e}`); }
    });

    client.on(Events.InteractionCreate, async (i: any) => {
        try {
            if (i.isMessageContextMenuCommand && i.commandName === 'Edit Tags') {
                const now = Date.now(), last = RATE_LIMIT.get(i.user.id) || 0;
                if (now - last < 10000) { if (i.isRepliable()) await i.reply({ content: '⏳ กรุณารอ 10 วินาที', flags: MessageFlags.Ephemeral }).catch(() => {}); return; }
                RATE_LIMIT.set(i.user.id, now);
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const content = i.targetMessage.content || '';
                const mentions = [...new Set((content.match(/<@!?(\d+)>/g) || []).map((m: string) => m.match(/\d+/)?.[0]).filter(Boolean))];
                if (!mentions.length || mentions[0] !== i.user.id) return i.editReply('❌ มรึงไม่ไช้เจ้าของคดี อย่า ซี้ซั้ว แก้ดี้');
                return i.editReply({ embeds: [new EmbedBuilder().setTitle('📋 จัดการแท็กคน').setDescription(`**ข้อความ:** ${content.substring(0, 100)}...\n**แท็กปัจจุบัน:** ${mentions.length} คน`).setColor(0x3b82f6)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`editag_add_${i.targetMessage.id}_${i.targetMessage.channel.id}`).setLabel('➕ เพิ่มคน').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`editag_rem_${i.targetMessage.id}_${i.targetMessage.channel.id}`).setLabel('➖ ลบคน').setStyle(ButtonStyle.Danger))] });
            }

            if (i.isButton && i.customId?.startsWith('editag_add_')) {
                return i.showModal(new ModalBuilder().setCustomId(`editag_modal_${i.customId.split('_')[2]}_${i.customId.split('_')[3]}`).setTitle('➕ เพิ่มคนในคดี').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_codes').setLabel('รหัสตำรวจ (คั่นด้วย , หรือ enter)').setStyle(TextInputStyle.Paragraph).setPlaceholder('001, 005, 010').setRequired(true).setMaxLength(200)))).catch(() => {});
            }

            if (i.isModalSubmit && i.customId?.startsWith('editag_modal_')) {
                await i.deferUpdate(); const p = i.customId.split('_');
                const ch = await client.channels.fetch(p[3]).catch(() => null); if (!ch) return i.editReply({ content: '❌ ไม่พบช่อง', components: [] });
                const msg = await ch.messages.fetch(p[2]).catch(() => null); if (!msg) return i.editReply({ content: '❌ ข้อความไม่อยู่แล้ว', components: [] });
                const codes = i.fields.getTextInputValue('input_codes').trim().split(/[\s,]+/).filter(Boolean);
                if (!codes.length) return i.editReply({ content: '❌ ไม่พบรหัส', components: [] });
                const { found, notFound } = findMembersByCode(i.guild, codes);
                if (!found.length) return i.editReply({ content: `❌ ไม่พบสมาชิกรหัส: ${notFound.join(', ')}`, components: [] });
                const opts = found.map(m => ({ label: (m.nickname || m.displayName).substring(0, 100), value: m.id }));
                const rows: any[] = [];
                for (let idx = 0; idx < opts.length; idx += 25) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`editag_addsel_${p[2]}_${p[3]}_${idx}`).setPlaceholder('เลือกคน').setMinValues(1).setMaxValues(Math.min(25, opts.length - idx)).addOptions(opts.slice(idx, idx + 25))));
                return i.editReply({ content: `✅ พบ ${found.length} คน${notFound.length ? `\n⚠️ ไม่พบรหัส: ${notFound.join(', ')}` : ''}\n**เลือกคนที่จะเพิ่ม:**`, components: rows });
            }

            if (i.isStringSelectMenu && i.customId?.startsWith('editag_addsel_')) {
                await i.deferUpdate(); const p = i.customId.split('_');
                const ch = await client.channels.fetch(p[3]).catch(() => null); if (!ch) return i.editReply({ content: '❌ ไม่พบช่อง', components: [] });
                const msg = await ch.messages.fetch(p[2]).catch(() => null); if (!msg) return i.editReply({ content: '❌ ข้อความไม่อยู่แล้ว', components: [] });
                let c = msg.content, added = 0;
                for (const id of i.values) { if (!c.includes(`<@${id}>`) && !c.includes(`<@!${id}>`)) { c += ` <@${id}>`; added++; } }
                await msg.edit(c); await i.editReply({ content: `✅ เพิ่ม ${added} คนสำเร็จ`, components: [] }); setTimeout(() => i.deleteReply().catch(() => {}), 3000); return;
            }

            if (i.isButton && i.customId?.startsWith('editag_rem_')) {
                await i.deferUpdate(); const p = i.customId.split('_');
                const ch = await client.channels.fetch(p[3]).catch(() => null); if (!ch) return i.editReply({ content: '❌ ไม่พบช่อง', components: [] });
                const msg = await ch.messages.fetch(p[2]).catch(() => null); if (!msg) return i.editReply({ content: '❌ ข้อความไม่อยู่แล้ว', components: [] });
                const ids = [...new Set((msg.content.match(/<@!?(\d+)>/g) || []).map((m: string) => m.match(/\d+/)?.[0]))].slice(1);
                const opts: { label: string; value: string }[] = [];
                for (const id of ids) { const m = await i.guild.members.fetch(id).catch(() => null); opts.push({ label: m ? m.displayName : id, value: id }); }
                if (!opts.length) return i.editReply({ content: '❌ ไม่มีคนอื่นให้ลบแล้ว', components: [] });
                const rows: any[] = [];
                for (let idx = 0; idx < opts.length; idx += 25) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`editag_remove_${p[2]}_${p[3]}_${idx}`).setPlaceholder('เลือกคนที่จะลบ').setMinValues(1).setMaxValues(Math.min(25, opts.length - idx)).addOptions(opts.slice(idx, idx + 25))));
                return i.editReply({ content: 'เลือกคนที่จะ **ลบ** ออก:', components: rows });
            }

            if (i.isStringSelectMenu && i.customId?.startsWith('editag_remove_')) {
                await i.deferUpdate(); const p = i.customId.split('_');
                const ch = await client.channels.fetch(p[3]).catch(() => null); if (!ch) return i.editReply({ content: '❌ ไม่พบช่อง', components: [] });
                const msg = await ch.messages.fetch(p[2]).catch(() => null); if (!msg) return i.editReply({ content: '❌ ข้อความไม่อยู่แล้ว', components: [] });
                let c = msg.content; for (const id of i.values) c = c.replace(new RegExp(`<@!?${id}>`, 'g'), '');
                c = c.replace(/\s+/g, ' ').trim(); await msg.edit(c);
                await i.editReply({ content: `✅ ลบ ${i.values.length} คนสำเร็จ`, components: [] }); setTimeout(() => i.deleteReply().catch(() => {}), 3000);
            }
        } catch (e) { logger.error('แก้แท็ก', `ผิดพลาด: ${e}`); if (i.isRepliable && !i.replied) await i.reply({ content: '❌ เกิดข้อผิดพลาด', flags: MessageFlags.Ephemeral }).catch(() => {}); }
    });
}