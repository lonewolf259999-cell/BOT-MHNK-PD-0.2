import { Client, GatewayIntentBits, Partials, Events, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import http from 'http';
import https from 'https';
import { env, BOT, validate } from './config';
import { configService } from './core/config.service';
import { logger } from './core/logger';

const errors = validate();
if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('❌ การตรวจสอบ Config ล้มเหลว:', errors.join(', '));
    process.exit(1);
}

let restartCount = 0;
let firstCrash = Date.now();
function safeRestart(reason: string): void {
    const now = Date.now();
    if (now - firstCrash > 24 * 60 * 60 * 1000) { restartCount = 0; firstCrash = now; }
    restartCount++;
    if (restartCount > BOT.MAX_RESTART_PER_DAY) { logger.error('SYSTEM', 'ถึงขีดจำกัดการรีสตาร์ทแล้ว'); return; }
    logger.warn('SYSTEM', `กำลังรีสตาร์ท (${restartCount}/${BOT.MAX_RESTART_PER_DAY}) | ${reason}`);
    setTimeout(() => process.exit(1), 15000);
}

let lastAlive = Date.now();
function heartbeat(): void { lastAlive = Date.now(); }

setInterval(() => {
    if (Date.now() - lastAlive > BOT.WATCHDOG_TIMEOUT_MIN * 60 * 1000) {
        logger.error('SYSTEM', 'Watchdog: บอทเงียบเกินไป กำลังรีสตาร์ท');
        safeRestart('Watchdog Timeout');
    }
}, BOT.WATCHDOG_CHECK_INTERVAL_MS);

const server = http.createServer((req, res) => {
    heartbeat();
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive! ✅');
});
server.listen(env.port, () => logger.info('SERVER', `HTTP เซิร์ฟเวอร์รันที่พอร์ต ${env.port}`));

setInterval(() => {
    const lib = env.renderUrl.startsWith('https://') ? https : http;
    lib.get(env.renderUrl, () => { heartbeat(); }).on('error', () => {});
}, BOT.SELF_PING_INTERVAL_MS);

process.on('unhandledRejection', (reason) => logger.error('SYSTEM', `ข้อผิดพลาดที่ไม่ถูกจัดการ: ${reason}`));
process.on('uncaughtException', (err) => logger.error('SYSTEM', `Exception ที่ไม่ถูกจัดการ: ${err.message}`));

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.on('error', (err) => logger.error('CLIENT', `Discord error: ${err.message}`));
client.on('warn', (info) => logger.warn('CLIENT', `Discord คำเตือน: ${info}`));
client.once(Events.ClientReady, async () => {
    heartbeat();
    logger.info('CLIENT', `${client.user?.tag} ออนไลน์พร้อมทำงาน!`);

    // ✅ ลงทะเบียน Slash Commands ทั้งหมดที่เดียว
    const commandDefs = [
        { name: '30day', description: '⏳ ตรวจสอบและจัดการสมาชิกครบ 30 วัน', permissions: 0 },
        { name: 'editpd', description: '📝 แก้ไขโปรไฟล์ตำรวจ (ชื่อ IC, เบอร์โทร, อายุ)' },
        { name: 'recount', description: '⚙️ แผงควบคุมตั้งค่าและนับยอดเคส' },
        { name: 'de', description: 'ลบข้อความล่าสุดในแชนแนลนี้ (สูงสุด 500)', permissions: PermissionFlagsBits.ManageMessages },
    ];

    for (const def of commandDefs) {
        try {
            const cmd = new SlashCommandBuilder().setName(def.name).setDescription(def.description);
            if (def.name === 'de') {
                cmd.addIntegerOption(opt => opt.setName('amount').setDescription('จำนวนข้อความที่ต้องการลบ (1-500)').setRequired(true).setMinValue(1).setMaxValue(500));
            }
            if (def.permissions !== undefined) cmd.setDefaultMemberPermissions(def.permissions);

            const existing = await client.application?.commands.fetch();
            const old = existing?.find(c => c.name === def.name);
            if (old) await client.application?.commands.edit(old.id, cmd);
            else await client.application?.commands.create(cmd);

            logger.info('COMMAND', `ลงทะเบียน /${def.name} สำเร็จ`);
        } catch (err) {
            logger.error('COMMAND', `ลงทะเบียน /${def.name} ล้มเหลว: ${err}`);
        }
    }
});

async function start(): Promise<void> {
    try {
        await configService.load();
    } catch {
        logger.error('STARTUP', 'โหลด config ไม่สำเร็จ — บอทอาจทำงานไม่ครบ');
    }

    const { setupWelcomeFeature } = await import('./features/welcome/listener');
    setupWelcomeFeature(client);

    const { setupLogtimeFeature } = await import('./features/logtime/listener');
    setupLogtimeFeature(client);

    const { setupBypdFeature } = await import('./features/bypd/listener');
    setupBypdFeature(client);

    const { setupReloadFeature } = await import('./features/reload/listener');
    setupReloadFeature(client);

    const { setupCountFeature } = await import('./features/count/listener');
    setupCountFeature(client);

    const { setupEditTagFeature } = await import('./features/edit-tag/listener');
    setupEditTagFeature(client);

    const { setupThirtyDayFeature } = await import('./features/thirtyday/listener');
    setupThirtyDayFeature(client);

    const { setupEditPdFeature } = await import('./features/editpd/listener');
    setupEditPdFeature(client);

    const { setupRecountFeature } = await import('./features/recount/listener');
    setupRecountFeature(client);

    const { setupClearFeature } = await import('./features/clear/listener');
    setupClearFeature(client);

    await client.login(env.botToken);
}

start().catch((err) => {
    logger.error('STARTUP', `เริ่มบอทไม่สำเร็จ: ${err.message}`);
    process.exit(1);
});
