import { Client, GatewayIntentBits, Partials, Events, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import http from 'http';
import https from 'https';
import { env, BOT, CACHE, validate } from './config';
import { configService } from './core/config.service';
import { rateLimiter } from './core/ratelimiter';
import { logger } from './core/logger';
import { clearAllReplyTimeouts, silentCatch } from './services/utils';

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
    if (now - firstCrash > BOT.RESTART_RESET_INTERVAL_MS) { restartCount = 0; firstCrash = now; }
    restartCount++;
    if (restartCount > BOT.MAX_RESTART_PER_DAY) { logger.error('SYSTEM', 'ถึงขีดจำกัดการรีสตาร์ทแล้ว'); return; }
    logger.warn('SYSTEM', `กำลังรีสตาร์ท (${restartCount}/${BOT.MAX_RESTART_PER_DAY}) | ${reason}`);
    setTimeout(() => process.exit(1), BOT.RESTART_DELAY_MS);
}

let lastAlive = Date.now();
function heartbeat(): void { lastAlive = Date.now(); }

setInterval(() => {
    if (Date.now() - lastAlive > BOT.WATCHDOG_TIMEOUT_MIN * 60 * 1000) {
        logger.error('SYSTEM', 'Watchdog: บอทเงียบเกินไป กำลังรีสตาร์ท');
        safeRestart('Watchdog Timeout');
    }
}, BOT.WATCHDOG_CHECK_INTERVAL_MS);

function parseBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: string) => body += chunk);
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    heartbeat();
    const url = req.url || '';
    const method = req.method || 'GET';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() }));
        return;
    }

    if (method === 'POST' && url === '/api/kick-member') {
        try {
            const body = await parseBody(req) as { userId?: string; reason?: string };
            const { userId, reason } = body;
            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
                return;
            }
            const guild = client.guilds.cache.get(env.guildId);
            if (!guild) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Guild not found' }));
                return;
            }
            await guild.members.kick(userId, reason || 'ถูกปลดออกจากระบบ');
            logger.info('API', `เตะ ${userId} ออกจากเซิร์ฟ${reason ? ` (${reason})` : ''}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `เตะ ${userId} ออกแล้ว` }));
        } catch (err: unknown) {
            logger.error('API', `เตะล้มเหลว: ${err instanceof Error ? err.message : String(err)}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
        }
        return;
    }

    if (method === 'POST' && url === '/api/swap-roles') {
        try {
            const body = await parseBody(req) as { userId?: string };
            const { userId } = body;
            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
                return;
            }
            const guild = client.guilds.cache.get(env.guildId);
            if (!guild) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Guild not found' }));
                return;
            }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Member not found in guild' }));
                return;
            }
            const removeRoleId = '1507114435033038929';
            const addRoleId = '1509659434681635096';
            await member.roles.remove(removeRoleId).catch(() => logger.warn('API', `ถอด role ${removeRoleId} ไม่สำเร็จ`));
            await member.roles.add(addRoleId).catch(() => logger.warn('API', `เพิ่ม role ${addRoleId} ไม่สำเร็จ`));
            logger.info('API', `สลับบทบาท ${userId}: ลบ ${removeRoleId} → เพิ่ม ${addRoleId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'สลับบทบาทสำเร็จ' }));
        } catch (err: unknown) {
            logger.error('API', `สลับบทบาทล้มเหลว: ${err instanceof Error ? err.message : String(err)}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
        }
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

// Cleanup expired rate limiter entries
setInterval(() => rateLimiter.cleanup(), CACHE.RATE_LIMITER_CLEANUP_INTERVAL_MS);

function gracefulShutdown(signal: string): void {
    logger.info('SHUTDOWN', `ได้รับสัญญาณ ${signal} — กำลังปิดระบบอย่างปลอดภัย...`);
    try {
        clearAllReplyTimeouts();
    } catch (e) { logger.warn('SHUTDOWN', String(e)); }
    client.destroy().catch(silentCatch('SHUTDOWN'));
    setTimeout(() => process.exit(0), BOT.GRACEFUL_SHUTDOWN_TIMEOUT_MS);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason: unknown) => {
    logger.error('SYSTEM', `ข้อผิดพลาดที่ไม่ถูกจัดการ: ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on('uncaughtException', (err: Error) => {
    logger.error('SYSTEM', `Exception ที่ไม่ถูกจัดการ: ${err.message}`);
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.on('error', (err) => logger.error('CLIENT', `Discord error: ${err.message}`));
client.on('warn', (info) => logger.warn('CLIENT', `Discord คำเตือน: ${info}`));
client.once(Events.ClientReady, async () => {
    heartbeat();
    logger.info('CLIENT', `${client.user?.tag} ออนไลน์พร้อมทำงาน!`);

    // ✅ ลงทะเบียน Slash Commands ทั้งหมดด้วย Bulk Registration
    // ✅ Slash Commands
    const slashDefs = [
        { name: 'editpd', description: '📝 แก้ไขโปรไฟล์ตำรวจ (ชื่อ IC, เบอร์โทร, อายุ)' },
        { name: 'recount', description: '⚙️ แผงควบคุมตั้งค่าและนับยอดเคส' },
        { name: 'reload', description: '🔄 รีโหลด config จาก Google Sheet', permissions: 0 },
        { name: 'de', description: 'ลบข้อความล่าสุดในแชนแนลนี้ (สูงสุด 500)', permissions: PermissionFlagsBits.ManageMessages },
    ];

    const commands: RESTPostAPIApplicationCommandsJSONBody[] = slashDefs.map(def => {
        const cmd = new SlashCommandBuilder().setName(def.name).setDescription(def.description);
        if (def.name === 'de') {
            cmd.addIntegerOption(opt => opt.setName('amount').setDescription('จำนวนข้อความที่ต้องการลบ (1-500)').setRequired(true).setMinValue(1).setMaxValue(500));
        }
        if (def.permissions !== undefined) cmd.setDefaultMemberPermissions(def.permissions);
        return cmd.toJSON();
    });

    // ✅ Context Menu — รวมไว้ใน bulk registration เพื่อป้องกันหายตอน restart
    commands.push(
        new ContextMenuCommandBuilder()
            .setName('Edit Tags')
            .setType(ApplicationCommandType.Message)
            .toJSON()
    );

    // ลบ Guild Commands เก่า (Guild level) เพื่อป้องกันคำสั่งซ้ำกับ Global
    try {
        const guild = client.guilds.cache.get(env.guildId);
        if (guild) {
            const existingGuild = await guild.commands.fetch();
            if (existingGuild.size > 0) {
                await guild.commands.set([]);
                logger.info('COMMAND', `ลบ ${existingGuild.size} คำสั่ง Guild level เก่า`);
            }
        }
    } catch (e: unknown) {
        logger.warn('COMMAND', `ลบ Guild commands ไม่สำเร็จ (ไม่ใช่ปัญหา): ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
        await client.application?.commands.set(commands);
        logger.info('COMMAND', `ลงทะเบียน ${commands.length} คำสั่งสำเร็จ (Bulk)`);
    } catch (err) {
        logger.error('COMMAND', `ลงทะเบียนคำสั่งล้มเหลว: ${err}`);
    }
});

async function start(): Promise<void> {
    try {
        await configService.load();
    } catch {
        logger.error('STARTUP', 'โหลด config ไม่สำเร็จ — บอทอาจทำงานไม่ครบ');
    }

    // ✅ Feature Registry — โหลดฟีเจอร์ทั้งหมด
    const featureSetups: ((client: Client) => void)[] = [
        (await import('./features/welcome/listener')).setupWelcomeFeature,
        (await import('./features/logtime/listener')).setupLogtimeFeature,
        (await import('./features/bypd/listener')).setupBypdFeature,
        (await import('./features/reload/listener')).setupReloadFeature,
        (await import('./features/count/listener')).setupCountFeature,
        (await import('./features/edit-tag/listener')).setupEditTagFeature,
        (await import('./features/editpd/listener')).setupEditPdFeature,
        (await import('./features/recount/listener')).setupRecountFeature,
        (await import('./features/clear/listener')).setupClearFeature,
        (await import('./features/proctor/listener')).setupProctorFeature,
    ];

    for (const setupFn of featureSetups) {
        try {
            setupFn(client);
        } catch (err) {
            logger.error('FEATURE', `โหลดฟีเจอร์ล้มเหลว: ${err}`);
        }
    }

    await client.login(env.botToken);
}

start().catch((err: Error) => {
    logger.error('STARTUP', `เริ่มบอทไม่สำเร็จ: ${err.message}`);
    process.exit(1);
});
