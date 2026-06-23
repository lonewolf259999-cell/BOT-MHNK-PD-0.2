import {
    Client,
    Events,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageContextMenuCommandInteraction,
    ButtonInteraction,
    ModalSubmitInteraction,
    StringSelectMenuInteraction,
    TextChannel,
    Message,
} from 'discord.js';
import { findMembersByCode } from '../../services/member.service';
import { rateLimiter } from '../../core/ratelimiter';
import { logger } from '../../core/logger';
import { PermissionService } from '../../services/permission.service';
import { silentCatch } from '../../services/utils';
import { configService } from '../../core/config.service';

type CachedInteraction = MessageContextMenuCommandInteraction<'cached'>;

/**
 * Fetch message by channelId and messageId helper.
 */
async function fetchMsg(client: Client, channelId: string, messageId: string): Promise<Message | null> {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return null;
    return (ch as TextChannel).messages.fetch(messageId).catch(() => null);
}

/**
 * Extract all mention IDs from a message content.
 */
function extractMentionIds(content: string): string[] {
    return [...new Set((content.match(/<@!?(\d+)>/g) || []).map((m: string) => m.match(/\d+/)?.[0]).filter(Boolean))] as string[];
}

async function sendEditTagLog(client: Client, guildId: string, channelId: string, messageId: string, userId: string, action: 'add' | 'remove', targetIds: string[]): Promise<void> {
    try {
        const logChannelId = configService.getEditTagLogChannelId();
        if (!logChannelId) { logger.warn('EditTagLog', 'ไม่มี EDIT_TAG_LOG_CHANNEL_ID'); return; }
        logger.info('EditTagLog', `พยายามส่ง log ไปยัง ${logChannelId}`);
        const ch = await client.channels.fetch(logChannelId);
        if (!ch?.isTextBased()) { logger.warn('EditTagLog', `แชนแนล ${logChannelId} ไม่ใช่ text channel`); return; }
        const jumpUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
        const label = action === 'add' ? '➕ เพิ่ม' : '➖ ลบ';
        const embed = new EmbedBuilder()
            .setTitle('📝 แก้ไขแท็กคดี')
            .setColor(action === 'add' ? 0x22c55e : 0xef4444)
            .addFields(
                { name: '👤 ผู้แก้ไข', value: `<@${userId}> (\`${userId}\`)`, inline: true },
                { name: label, value: targetIds.map(id => `<@${id}>`).join(' ') || '-', inline: false },
                { name: '🔗 ข้อความ', value: `[Jump to message](${jumpUrl})` },
            )
            .setTimestamp();
        await (ch as TextChannel).send({ embeds: [embed] });
        logger.info('EditTagLog', 'ส่ง log สำเร็จ');
    } catch (err) {
        logger.error('EditTagLog', `ส่ง log ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export function setupEditTagFeature(client: Client): void {
    // Context Menu "Edit Tags" ลงทะเบียนผ่าน Bulk Registration ใน index.ts แล้ว

    client.on(Events.InteractionCreate, async (i) => {
        try {
            // --- Context Menu: Edit Tags ---
            if (i.isMessageContextMenuCommand() && i.commandName === 'Edit Tags') {
                const ctx = i as CachedInteraction;
                if (!rateLimiter.check(`editag:${ctx.user.id}`, 1, 10000)) {
                    if (ctx.isRepliable()) await ctx.reply({ content: '⏳ กรุณารอ 10 วินาที', flags: MessageFlags.Ephemeral }).catch(silentCatch('EditTag'));
                    return;
                }
                await ctx.deferReply({ flags: MessageFlags.Ephemeral });
                const content = ctx.targetMessage.content || '';
                const mentionIds = extractMentionIds(content);

                // เช็คว่า mention แรก = เจ้าของคดี (เรา)
                if (mentionIds.length === 0 || mentionIds[0] !== ctx.user.id) {
                    await ctx.editReply('❌ มรึงไม่ใช่เจ้าของคดี อย่าซี้ซั้วแก้ดี้');
                    return;
                }

                // Check permission via config
                if (!PermissionService.canEditTag(ctx, ctx.targetMessage)) {
                    await ctx.editReply('❌ คุณไม่มีสิทธิ์แก้ไขแท็กในคดีนี้');
                    return;
                }

                await ctx.editReply({
                    embeds: [new EmbedBuilder().setTitle('📋 จัดการแท็กคน').setDescription(`**ข้อความ:** ${content.substring(0, 100)}...\n**แท็กปัจจุบัน:** ${mentionIds.length} คน`).setColor(0x3b82f6)],
                    components: [
                        new ActionRowBuilder<ButtonBuilder>().addComponents(
                            new ButtonBuilder().setCustomId(`editag_add_${ctx.targetMessage.id}_${ctx.targetMessage.channel.id}`).setLabel('➕ เพิ่มคน').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`editag_rem_${ctx.targetMessage.id}_${ctx.targetMessage.channel.id}`).setLabel('➖ ลบคน').setStyle(ButtonStyle.Danger),
                        ),
                    ],
                });
                return;
            }

            // --- Button: Add tag ---
            if (i.isButton() && i.customId?.startsWith('editag_add_')) {
                const btn = i as ButtonInteraction<'cached'>;
                await btn.showModal(
                    new ModalBuilder()
                        .setCustomId(`editag_modal_${btn.customId.split('_')[2]}_${btn.customId.split('_')[3]}`)
                        .setTitle('➕ เพิ่มคนในคดี')
                        .addComponents(
                            new ActionRowBuilder<TextInputBuilder>().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('input_codes')
                                    .setLabel('รหัสตำรวจ (คั่นด้วย , หรือ enter)')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder('001, 005, 010')
                                    .setRequired(true)
                                    .setMaxLength(200),
                            ),
                        ),
                ).catch(silentCatch('EditTag'));
                return;
            }

            // --- Modal Submit: process codes ---
            if (i.isModalSubmit() && i.customId?.startsWith('editag_modal_')) {
                const modal = i as ModalSubmitInteraction<'cached'>;
                await modal.deferUpdate();
                const p = modal.customId.split('_');
                const msg = await fetchMsg(client, p[3], p[2]);
                if (!msg) {
                    await modal.editReply({ content: '❌ ไม่พบข้อความ', components: [] });
                    return;
                }
                const codes = modal.fields.getTextInputValue('input_codes').trim().split(/[\s,]+/).filter(Boolean);
                if (!codes.length) {
                    await modal.editReply({ content: '❌ ไม่พบรหัส', components: [] });
                    return;
                }
                const guild = modal.guild;
                if (!guild) {
                    await modal.editReply({ content: '❌ ไม่พบ Guild', components: [] });
                    return;
                }
                const { found, notFound } = findMembersByCode(guild, codes);
                if (!found.length) {
                    await modal.editReply({ content: `❌ ไม่พบสมาชิกรหัส: ${notFound.join(', ')}`, components: [] });
                    return;
                }
                const opts = found.map(m => ({ label: (m.nickname || m.displayName).substring(0, 100), value: m.id }));
                const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
                for (let idx = 0; idx < opts.length; idx += 25) {
                    rows.push(
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`editag_addsel_${p[2]}_${p[3]}_${idx}`)
                                .setPlaceholder('เลือกคน')
                                .setMinValues(1)
                                .setMaxValues(Math.min(25, opts.length - idx))
                                .addOptions(opts.slice(idx, idx + 25)),
                        ),
                    );
                }
                await modal.editReply({
                    content: `✅ พบ ${found.length} คน${notFound.length ? `\n⚠️ ไม่พบรหัส: ${notFound.join(', ')}` : ''}\n**เลือกคนที่จะเพิ่ม:**`,
                    components: rows,
                });
                return;
            }

            // --- String Select: add selected ---
            if (i.isStringSelectMenu() && i.customId?.startsWith('editag_addsel_')) {
                const sel = i as StringSelectMenuInteraction<'cached'>;
                await sel.deferUpdate();
                const p = sel.customId.split('_');
                const msg = await fetchMsg(client, p[3], p[2]);
                if (!msg) {
                    await sel.editReply({ content: '❌ ไม่พบข้อความ', components: [] });
                    return;
                }
                let c = msg.content;
                let added = 0;
                for (const id of sel.values) {
                    if (!c.includes(`<@${id}>`) && !c.includes(`<@!${id}>`)) {
                        c += ` <@${id}>`;
                        added++;
                    }
                }
                await msg.edit(c);
                await sel.editReply({ content: `✅ เพิ่ม ${added} คนสำเร็จ`, components: [] });
                if (added > 0) {
                    await sendEditTagLog(client, sel.guildId, p[3], p[2], sel.user.id, 'add', sel.values);
                }
                setTimeout(() => sel.deleteReply().catch(silentCatch('EditTag')), 3000);
                return;
            }

            // --- Button: Remove tag ---
            if (i.isButton() && i.customId?.startsWith('editag_rem_')) {
                const btn = i as ButtonInteraction<'cached'>;
                await btn.deferUpdate();
                const p = btn.customId.split('_');
                const msg = await fetchMsg(client, p[3], p[2]);
                if (!msg) {
                    await btn.editReply({ content: '❌ ไม่พบข้อความ', components: [] });
                    return;
                }
                const ids = extractMentionIds(msg.content);

                // ✅ ข้าม index แรก (เจ้าของคดี) — ห้ามลบตัวเอง
                const removableIds = ids.slice(1);
                if (removableIds.length === 0) {
                    await btn.editReply({ content: '❌ ไม่มีคนอื่นให้ลบแล้ว', components: [] });
                    return;
                }

                const opts: { label: string; value: string }[] = [];
                const guild = btn.guild;
                for (const id of removableIds) {
                    const m = guild ? await guild.members.fetch(id).catch(() => null) : null;
                    opts.push({ label: m ? m.displayName : id, value: id });
                }
                if (!opts.length) {
                    await btn.editReply({ content: '❌ ไม่มีคนอื่นให้ลบแล้ว', components: [] });
                    return;
                }
                const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
                for (let idx = 0; idx < opts.length; idx += 25) {
                    rows.push(
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`editag_remove_${p[2]}_${p[3]}_${idx}`)
                                .setPlaceholder('เลือกคนที่จะลบ')
                                .setMinValues(1)
                                .setMaxValues(Math.min(25, opts.length - idx))
                                .addOptions(opts.slice(idx, idx + 25)),
                        ),
                    );
                }
                await btn.editReply({ content: 'เลือกคนที่จะ **ลบ** ออก:', components: rows });
                return;
            }

            // --- String Select: remove selected ---
            if (i.isStringSelectMenu() && i.customId?.startsWith('editag_remove_')) {
                const sel = i as StringSelectMenuInteraction<'cached'>;
                await sel.deferUpdate();
                const p = sel.customId.split('_');
                const msg = await fetchMsg(client, p[3], p[2]);
                if (!msg) {
                    await sel.editReply({ content: '❌ ไม่พบข้อความ', components: [] });
                    return;
                }
                let c = msg.content;
                for (const id of sel.values) {
                    c = c.replace(new RegExp(`<@!?${id}>`, 'g'), '');
                }
                c = c.replace(/\s+/g, ' ').trim();
                await msg.edit(c);
                await sel.editReply({ content: `✅ ลบ ${sel.values.length} คนสำเร็จ`, components: [] });
                await sendEditTagLog(client, sel.guildId, p[3], p[2], sel.user.id, 'remove', sel.values);
                setTimeout(() => sel.deleteReply().catch(silentCatch('EditTag')), 3000);
                return;
            }
        } catch (e) {
            logger.error('แก้แท็ก', `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
            if ('reply' in i && typeof i.reply === 'function' && !i.replied) {
                await i.reply({ content: '❌ เกิดข้อผิดพลาด', flags: MessageFlags.Ephemeral }).catch(silentCatch('EditTag'));
            }
        }
    });
}