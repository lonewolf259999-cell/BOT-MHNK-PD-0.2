import { Client, Events, MessageFlags, ChatInputCommandInteraction, GuildTextBasedChannel } from 'discord.js';
import { replyAndDelete, sleep } from '../../services/utils';
import { logger } from '../../core/logger';

const ROUND_PAUSE_MS = 3000; // พักระหว่างรอบ (ms)
const BATCH_SIZE = 100;      // จำนวนลบต่อ batch (Discord limit)

export function setupClearFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i) => {
        if (!i.isChatInputCommand() || i.commandName !== 'de') return;
        const cmd = i as ChatInputCommandInteraction<'cached'>;
        if (!cmd.memberPermissions?.has('ManageMessages')) {
            await cmd.reply({ content: '❌ คุณไม่มีสิทธิ์ Manage Messages', flags: MessageFlags.Ephemeral });
            return;
        }

        const amount = cmd.options.getInteger('amount');
        const all = cmd.options.getBoolean('all');

        // ตรวจสอบว่าผู้ใช้เลือกอย่างใดอย่างหนึ่ง
        if (!amount && !all) {
            await cmd.reply({ content: '⚠️ กรุณาระบุจำนวนที่ต้องการลบ หรือใช้ `all` เพื่อลบทั้งหมด\n`/de amount:100` หรือ `/de all:True`', flags: MessageFlags.Ephemeral });
            return;
        }

        const channel = cmd.channel;
        if (!channel || !channel.isTextBased()) {
            await cmd.reply({ content: '❌ ไม่พบแชนแนล', flags: MessageFlags.Ephemeral });
            return;
        }

        if (all) {
            await handleDeleteAll(cmd, channel as GuildTextBasedChannel);
        } else {
            await handleDeleteAmount(cmd, channel as GuildTextBasedChannel, amount!);
        }
    });
}

/**
 * ลบตามจำนวนที่กำหนด (เหมือนเดิม)
 */
async function handleDeleteAmount(
    cmd: ChatInputCommandInteraction<'cached'>,
    channel: GuildTextBasedChannel,
    amount: number
): Promise<void> {
    await cmd.deferReply({ flags: MessageFlags.Ephemeral });
    let totalDeleted = 0;
    let stoppedEarly = false;

    try {
        await cmd.editReply({ content: `🗑️ กำลังลบ... 0/${amount}` });
        for (let n = 0; n < amount; n += BATCH_SIZE) {
            const remaining = amount - totalDeleted;
            const toDelete = Math.min(BATCH_SIZE, remaining);
            const deleted = await channel.bulkDelete(toDelete, true);
            totalDeleted += deleted.size;
            await cmd.editReply({ content: `🗑️ กำลังลบ... ${totalDeleted}/${amount}` });
            if (totalDeleted >= amount || deleted.size < toDelete) {
                if (deleted.size < toDelete) stoppedEarly = true;
                break;
            }
            if (totalDeleted < amount) await sleep(3000 + Math.random() * 1000);
        }
        await replyAndDelete(cmd, stoppedEarly
            ? `⚠️ ลบได้ ${totalDeleted}/${amount} ข้อความ (บางส่วนเก่าเกิน 14 วัน)`
            : `✅ ลบข้อความแล้ว ${totalDeleted}/${amount} ข้อความ`
        );
    } catch (err: unknown) {
        if (totalDeleted > 0) {
            try {
                await cmd.editReply({ content: `⚠️ ลบได้ ${totalDeleted}/${amount} ข้อความ แล้วพบข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}` });
            } catch (e) { logger.warn('Clear', String(e)); }
            return;
        }
        await cmd.editReply({ content: `❌ ไม่สามารถลบข้อความได้: ${err instanceof Error ? err.message : String(err)}` });
    }
}

/**
 * ลบทั้งหมดในห้อง — ดึงข้อความมาลบทีละรอบ (batch ละ 100) พักระหว่างรอบ
 * ใช้ fetch + bulkDelete เพื่อข้ามข้อความที่เก่าเกิน 14 วัน
 */
async function handleDeleteAll(
    cmd: ChatInputCommandInteraction<'cached'>,
    channel: GuildTextBasedChannel
): Promise<void> {
    await cmd.deferReply({ flags: MessageFlags.Ephemeral });
    let totalDeleted = 0;
    let round = 0;
    let lastId: string | undefined;
    let hasMore = true;

    try {
        await cmd.editReply({ content: `🗑️ เริ่มลบทั้งหมดในห้อง...` });

        while (hasMore) {
            round++;
            const fetchOpts: { limit: number; before?: string } = { limit: BATCH_SIZE };
            if (lastId) fetchOpts.before = lastId;

            const fetched = await channel.messages.fetch(fetchOpts);
            if (fetched.size === 0) {
                hasMore = false;
                break;
            }

            const ids: string[] = [];
            fetched.forEach((msg) => ids.push(msg.id));
            const last = fetched.last();
            lastId = last?.id;

            // ลบทีละ batch (Discord จะข้ามข้อความที่เก่าเกิน 14 วันให้เอง)
            const deleted = await channel.bulkDelete(ids, true);
            totalDeleted += deleted.size;

            await cmd.editReply({ content: `🗑️ รอบที่ ${round} — ลบไปแล้ว ${totalDeleted} ข้อความ` });

            // ถ้าได้น้อยกว่าที่ขอ = ไม่มีข้อความใหม่เหลือ หรือเก่าเกิน 14 วัน
            if (deleted.size < ids.length) {
                hasMore = false;
                break;
            }

            // พักระหว่างรอบเพื่อลดความเสี่ยง rate limit
            await sleep(ROUND_PAUSE_MS + Math.random() * 1000);
        }

        await replyAndDelete(cmd,
            totalDeleted > 0
                ? `✅ ลบทั้งหมดในห้องนี้แล้ว ${totalDeleted} ข้อความ (ข้ามข้อความเก่าเกิน 14 วัน)`
                : '⚠️ ไม่พบข้อความที่สามารถลบได้ในห้องนี้ (อาจเก่าเกิน 14 วัน)',
            8000
        );
    } catch (err: unknown) {
        if (totalDeleted > 0) {
            try {
                await cmd.editReply({ content: `⚠️ ลบไปแล้ว ${totalDeleted} ข้อความ แล้วพบข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}` });
            } catch (e) { logger.warn('Clear', String(e)); }
            return;
        }
        await cmd.editReply({ content: `❌ ไม่สามารถลบข้อความได้: ${err instanceof Error ? err.message : String(err)}` });
    }
}