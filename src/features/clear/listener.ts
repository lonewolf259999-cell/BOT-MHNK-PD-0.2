import { Client, Events, MessageFlags } from 'discord.js';
import { replyAndDelete } from '../../services/utils';

export function setupClearFeature(client: Client): void {
    client.on(Events.InteractionCreate, async (i: any) => {
        if (!i.isChatInputCommand || i.commandName !== 'de') return;
        if (!i.memberPermissions?.has('ManageMessages')) return i.reply({ content: '❌ คุณไม่มีสิทธิ์ Manage Messages', flags: MessageFlags.Ephemeral });

        const amount = i.options.getInteger('amount');
        const BATCH_SIZE = 100;
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        let totalDeleted = 0, stoppedEarly = false;

        try {
            await i.editReply({ content: `🗑️ กำลังลบ... 0/${amount}` });
            for (let n = 0; n < amount; n += BATCH_SIZE) {
                const remaining = amount - totalDeleted;
                const toDelete = Math.min(BATCH_SIZE, remaining);
                const deleted = await i.channel.bulkDelete(toDelete, true);
                totalDeleted += deleted.size;
                await i.editReply({ content: `🗑️ กำลังลบ... ${totalDeleted}/${amount}` });
                if (totalDeleted >= amount || deleted.size < toDelete) {
                    if (deleted.size < toDelete) stoppedEarly = true;
                    break;
                }
                if (totalDeleted < amount) await new Promise(r => setTimeout(r, 3000 + Math.random() * 1000));
            }
            await replyAndDelete(i, stoppedEarly ? `⚠️ ลบได้ ${totalDeleted}/${amount} ข้อความ (บางส่วนเก่าเกิน 14 วัน)` : `✅ ลบข้อความแล้ว ${totalDeleted}/${amount} ข้อความ`);
        } catch (err: any) {
            if (totalDeleted > 0) { try { await i.editReply({ content: `⚠️ ลบได้ ${totalDeleted}/${amount} ข้อความ แล้วพบข้อผิดพลาด: ${err.message}` }); } catch {} return; }
            await i.editReply({ content: `❌ ไม่สามารถลบข้อความได้: ${err.message}` });
        }
    });
}