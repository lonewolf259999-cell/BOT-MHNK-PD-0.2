import { Client, Events, MessageFlags, ChatInputCommandInteraction } from 'discord.js';
import { replyAndDelete } from '../../services/utils';

export function setupClearFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i) => {
        if (!i.isChatInputCommand() || i.commandName !== 'de') return;
        const cmd = i as ChatInputCommandInteraction<'cached'>;
        if (!cmd.memberPermissions?.has('ManageMessages')) {
            await cmd.reply({ content: '❌ คุณไม่มีสิทธิ์ Manage Messages', flags: MessageFlags.Ephemeral });
            return;
        }

        const amount = cmd.options.getInteger('amount', true);
        const BATCH_SIZE = 100;
        await cmd.deferReply({ flags: MessageFlags.Ephemeral });
        let totalDeleted = 0;
        let stoppedEarly = false;

        const channel = cmd.channel;
        if (!channel || !channel.isTextBased()) {
            await cmd.editReply({ content: '❌ ไม่พบแชนแนล' });
            return;
        }

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
                if (totalDeleted < amount) await new Promise(r => setTimeout(r, 3000 + Math.random() * 1000));
            }
            await replyAndDelete(cmd, stoppedEarly ? `⚠️ ลบได้ ${totalDeleted}/${amount} ข้อความ (บางส่วนเก่าเกิน 14 วัน)` : `✅ ลบข้อความแล้ว ${totalDeleted}/${amount} ข้อความ`);
        } catch (err: unknown) {
            if (totalDeleted > 0) {
                try {
                    await cmd.editReply({ content: `⚠️ ลบได้ ${totalDeleted}/${amount} ข้อความ แล้วพบข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}` });
                } catch { /* ignore */ }
                return;
            }
            await cmd.editReply({ content: `❌ ไม่สามารถลบข้อความได้: ${err instanceof Error ? err.message : String(err)}` });
        }
    });
}