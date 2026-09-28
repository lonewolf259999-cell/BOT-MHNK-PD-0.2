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
    Interaction,
} from 'discord.js';
import { findMembersByCode } from '../../services/member.service';
import { rateLimiter } from '../../core/ratelimiter';
import { logger } from '../../core/logger';
import { PermissionService } from '../../services/permission.service';
import { silentCatch } from '../../services/utils';

type CachedInteraction = MessageContextMenuCommandInteraction<'cached'>;

export type ErrorReplyMode = 'reply' | 'editReply' | 'followUp' | 'skip';

/**
 * เลือกวิธีแจ้งข้อผิดพลาดให้ตรงกับสถานะของ interaction
 *
 * Discord ยอมให้ตอบครั้งเดียว และวิธีตอบต้องตรงสถานะ ไม่งั้นโดนปฏิเสธ
 *   ยังไม่ตอบ         → reply
 *   บอก "รอแป๊บ" แล้ว  → editReply  (ฟีเจอร์นี้บอกรอแป๊บไว้ถึง 5 จุดก่อนเริ่มทำงานจริง)
 *   ตอบไปแล้ว         → followUp
 *
 * ของเดิมเช็คแค่ "ตอบไปแล้วหรือยัง" แล้วใช้ reply เสมอ พอพังหลังบอกรอแป๊บ
 * Discord ปฏิเสธ ข้อความหายเงียบ ผู้ใช้ค้างอยู่ที่ "กำลังคิด..." จนขึ้นว่าแอปไม่ตอบสนอง
 */
export function pickErrorReplyMode(state: { repliable: boolean; replied: boolean; deferred: boolean }): ErrorReplyMode {
    if (!state.repliable) return 'skip';
    if (state.replied) return 'followUp';
    if (state.deferred) return 'editReply';
    return 'reply';
}

/** แจ้งข้อผิดพลาดให้ผู้ใช้เห็นจริง ไม่ใช่ปล่อยค้างที่ "กำลังคิด..." */
async function notifyError(i: Interaction): Promise<void> {
    const mode = pickErrorReplyMode({
        repliable: i.isRepliable(),
        replied: 'replied' in i ? Boolean(i.replied) : false,
        deferred: 'deferred' in i ? Boolean(i.deferred) : false,
    });
    if (mode === 'skip' || !i.isRepliable()) return;

    const content = '❌ เกิดข้อผิดพลาด';
    try {
        if (mode === 'followUp') await i.followUp({ content, flags: MessageFlags.Ephemeral });
        // ล้างปุ่ม/เมนูที่ค้างอยู่ด้วย เพราะมันใช้ต่อไม่ได้แล้ว
        else if (mode === 'editReply') await i.editReply({ content, components: [] });
        else await i.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (e) {
        logger.warn('แก้แท็ก', `แจ้งข้อผิดพลาดให้ผู้ใช้ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/**
 * Fetch message by channelId and messageId helper.
 */
async function fetchMsg(client: Client, channelId: string, messageId: string): Promise<Message | null> {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return null;
    return (ch as TextChannel).messages.fetch(messageId).catch(() => null);
}

/**
 * แก้บรรทัดแท็กในข้อความ
 *
 * ปกติแก้ข้อความเดิมได้เลย แต่ถ้าข้อความไม่ใช่ของบอท (มาจากระบบภายนอก) จะแก้ไม่ได้
 * ทางสำรองคือลบแล้วส่งใหม่ — ซึ่งเดิมส่งใหม่แค่บรรทัดแท็ก ทำให้
 *   1) กล่องรายละเอียดคดี (เจ้าหน้าที่/ผู้ต้องหา/คดี/ค่าปรับ) หายทั้งกล่อง
 *   2) เครื่องหมาย ✅ หายไป พอกดส่งย้อนหลังครั้งหน้า บอทจะส่งใบนั้นซ้ำ แล้วยอดบวกเกิน
 * จึงต้องยกกล่องและเครื่องหมายเดิมไปด้วยทุกครั้ง
 */
async function editTagLine(msg: Message, content: string): Promise<void> {
    try {
        await msg.edit(content);
        return;
    } catch { /* แก้ไม่ได้ → ใช้ทางสำรอง */ }

    if (!msg.channel.isTextBased()) return;
    const embeds = msg.embeds.map(e => e.toJSON());
    const emojis = msg.reactions.cache.map(r => r.emoji.name).filter((n): n is string => Boolean(n));

    await msg.delete();
    const sent = await (msg.channel as import('discord.js').GuildTextBasedChannel).send({ content, embeds });
    for (const emoji of emojis) {
        await sent.react(emoji).catch(silentCatch('EditTag'));
    }
}

/**
 * Extract all mention IDs from a message content.
 */
function extractMentionIds(content: string): string[] {
    return [...new Set((content.match(/<@!?(\d+)>/g) || []).map((m: string) => m.match(/\d+/)?.[0]).filter(Boolean))] as string[];
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
                await editTagLine(msg, c);
                await sel.editReply({ content: `✅ เพิ่ม ${added} คนสำเร็จ`, components: [] });
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
                await editTagLine(msg, c);
                await sel.editReply({ content: `✅ ลบ ${sel.values.length} คนสำเร็จ`, components: [] });
                setTimeout(() => sel.deleteReply().catch(silentCatch('EditTag')), 3000);
                return;
            }
        } catch (e) {
            logger.error('แก้แท็ก', `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
            await notifyError(i);
        }
    });
}