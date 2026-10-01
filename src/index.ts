import { Client, GatewayIntentBits, Partials, Events, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { env, BOT, CACHE, validate } from './config';
import { configService } from './core/config.service';
import { rateLimiter } from './core/ratelimiter';
import { logger, recent, bufferStats, type LogLevel } from './core/logger';
import { startLogStore, flushLogSheet, pendingLogRows } from './core/logstore.service';
import { clearAllReplyTimeouts, silentCatch } from './services/utils';
import { flushPendingCounts, pendingCountOps } from './features/count/count.service';

const errors = validate();
if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('❌ การตรวจสอบ Config ล้มเหลว:\n  ' + errors.join('\n  '));
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

// ---- Watchdog ----
// เฝ้าดู "การเชื่อมต่อ Discord" ไม่ใช่เว็บเซิร์ฟเวอร์ของตัวเอง
// ของเดิมนับ heartbeat จาก HTTP request ที่เข้ามา ซึ่ง self-ping เติมให้เองทุก 7 นาที
// ทำให้ lastAlive สดตลอดเวลา และ watchdog ไม่มีวันทำงาน แม้ Discord จะหลุดไปนานแค่ไหน
let lastDiscordOk = Date.now();

setInterval(() => {
    if (client.isReady()) { lastDiscordOk = Date.now(); return; }
    if (Date.now() - lastDiscordOk > BOT.WATCHDOG_TIMEOUT_MIN * 60 * 1000) {
        logger.error('SYSTEM', `Watchdog: Discord หลุดเกิน ${BOT.WATCHDOG_TIMEOUT_MIN} นาที กำลังรีสตาร์ท`);
        lastDiscordOk = Date.now(); // กันสั่งรีสตาร์ทซ้ำระหว่างรอ RESTART_DELAY_MS
        safeRestart('Discord disconnected');
    }
}, BOT.WATCHDOG_CHECK_INTERVAL_MS);

/**
 * เทียบรหัสผ่านแบบไม่หลุดเวลา
 *
 * เทียบด้วย === จะคืนผลเร็วกว่าเมื่อตัวอักษรแรกไม่ตรง ซึ่งพอวัดเวลาหลาย ๆ ครั้ง
 * จะเดารหัสทีละตัวได้ — ช่องนี้เปิดรับจากอินเทอร์เน็ต จึงไม่ควรเปิดช่องนั้นไว้
 */
function tokenMatches(given: string): boolean {
    const want = env.logApiToken;
    if (!want || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(want);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

const LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR', 'DEBUG'];

/** อ่านตัวกรองจาก query string ของ /logs */
function parseLogQuery(url: URL): Parameters<typeof recent>[0] {
    const levelsRaw = (url.searchParams.get('level') || '').toUpperCase();
    const levels = LEVELS.filter(l => levelsRaw.split(',').map(s => s.trim()).includes(l));
    const limit = Number(url.searchParams.get('limit'));
    const since = Number(url.searchParams.get('since'));
    return {
        levels: levels.length > 0 ? levels : undefined,
        context: url.searchParams.get('context') || undefined,
        search: url.searchParams.get('q') || undefined,
        since: Number.isFinite(since) && since > 0 ? since : undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    };
}

/**
 * ส่ง log ที่เก็บไว้ในหน่วยความจำให้หน้าเว็บ
 *
 * อ่านจากหน่วยความจำ ไม่ใช่จากไฟล์ เพราะบนโฮสต์ปิดการเขียนไฟล์ไว้ (LOG_TO_FILE=false)
 * ข้อความถูกกรองความลับออกตั้งแต่ตอนเก็บแล้ว (ดู redact ใน core/logger)
 */
function handleLogs(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', 'http://localhost');
    const given = (req.headers['x-log-token'] as string | undefined) || url.searchParams.get('token') || '';

    if (!env.logApiToken) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'ยังไม่ได้ตั้ง LOG_API_TOKEN — ช่องนี้ถูกปิดไว้' }));
        return;
    }
    if (!tokenMatches(given)) {
        logger.warn('LOGAPI', 'มีการขอ log ด้วยรหัสผ่านที่ไม่ถูกต้อง');
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'รหัสผ่านไม่ถูกต้อง' }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
        ok: true,
        bot: { ready: client.isReady(), uptime: process.uptime(), wsPing: client.ws.ping },
        buffer: bufferStats(),
        pendingSheetRows: pendingLogRows(),
        pendingCountOps: pendingCountOps(),
        entries: recent(parseLogQuery(url)),
    }));
}

// ---- HTTP server (health check + กันโฮสต์ฟรีหลับ) ----
const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/logs')) {
        handleLogs(req, res);
        return;
    }
    if (req.url === '/health') {
        const ready = client.isReady();
        // ตอบ 503 เมื่อ Discord หลุด เพื่อให้ตัวมอนิเตอร์ภายนอก (เช่น UptimeRobot)
        // แจ้งเตือนได้ทันที แทนที่จะเห็น 200 แล้วเข้าใจว่าบอทยังปกติดี
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: ready ? 'ok' : 'discord_disconnected',
            discord: ready,
            wsPing: client.ws.ping,
            uptime: process.uptime(),
            timestamp: Date.now(),
        }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive! ✅');
});
server.listen(env.port, () => logger.info('SERVER', `HTTP เซิร์ฟเวอร์รันที่พอร์ต ${env.port}`));

// ---- Self-ping ----
// มีไว้กันโฮสต์ฟรีหลับอย่างเดียว ไม่ยุ่งกับ watchdog อีกต่อไป
setInterval(() => {
    const lib = env.renderUrl.startsWith('https://') ? https : http;
    const req = lib.get(env.renderUrl, (res) => { res.resume(); }); // resume() = ทิ้ง body ให้ socket ถูกคืน ไม่งั้นรั่วสะสม
    req.setTimeout(10000, () => req.destroy());
    req.on('error', () => { /* ปลุกไม่ติดก็ไม่เป็นไร รอบหน้าเอาใหม่ */ });
}, BOT.SELF_PING_INTERVAL_MS);

// Cleanup expired rate limiter entries
setInterval(() => rateLimiter.cleanup(), CACHE.RATE_LIMITER_CLEANUP_INTERVAL_MS);

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return; // กันสัญญาณซ้ำ (SIGINT ตามด้วย SIGTERM) สั่งปิดซ้อนกัน
    shuttingDown = true;
    logger.info('SHUTDOWN', `ได้รับสัญญาณ ${signal} — กำลังปิดระบบอย่างปลอดภัย...`);
    try {
        clearAllReplyTimeouts();
    } catch (e) { logger.warn('SHUTDOWN', String(e)); }

    // ยอดที่เพิ่งนับได้จะถูกพักไว้ในหน่วยความจำราว 3 วินาทีก่อนเขียนลงชีต
    // ถ้าดับตอนนั้นพอดี ยอดช่วงนั้นหายไปเลย — เขียนให้จบก่อนปิด
    const pending = pendingCountOps();
    if (pending > 0) {
        logger.info('SHUTDOWN', `เขียนยอดที่ยังค้างอยู่ ${pending} รายการลงชีตก่อนปิด`);
        await Promise.race([
            flushPendingCounts().catch(silentCatch('SHUTDOWN')),
            new Promise<void>(resolve => setTimeout(resolve, BOT.SHUTDOWN_FLUSH_TIMEOUT_MS)),
        ]);
    }

    // log ที่ยังค้างในคิวก็ต้องลงชีตให้ทัน ไม่งั้นเหตุการณ์ช่วงท้ายหายไปพร้อม process
    const pendingLogs = pendingLogRows();
    if (pendingLogs > 0) {
        logger.info('SHUTDOWN', `เขียน log ที่ยังค้างอยู่ ${pendingLogs} แถวลงชีตก่อนปิด`);
        await Promise.race([
            flushLogSheet().catch(silentCatch('SHUTDOWN')),
            new Promise<void>(resolve => setTimeout(resolve, BOT.SHUTDOWN_FLUSH_TIMEOUT_MS)),
        ]);
    }

    client.destroy().catch(silentCatch('SHUTDOWN'));
    server.close();
    setTimeout(() => { logger.close(); process.exit(0); }, BOT.GRACEFUL_SHUTDOWN_TIMEOUT_MS);
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
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
// เห็นชัดใน log ว่าหลุด/ต่อใหม่ตอนไหน เวลาต้องไล่ปัญหาย้อนหลัง
client.on(Events.ShardDisconnect, (_ev, id) => logger.warn('CLIENT', `Shard ${id} หลุดการเชื่อมต่อ`));
client.on(Events.ShardReconnecting, (id) => logger.warn('CLIENT', `Shard ${id} กำลังเชื่อมต่อใหม่`));
client.on(Events.ShardResume, (id) => logger.info('CLIENT', `Shard ${id} กลับมาเชื่อมต่อแล้ว`));
client.once(Events.ClientReady, async () => {
    lastDiscordOk = Date.now();
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
            cmd.addIntegerOption(opt => opt.setName('amount').setDescription('จำนวนข้อความที่ต้องการลบ (1-500)').setRequired(false).setMinValue(1).setMaxValue(500));
            cmd.addBooleanOption(opt => opt.setName('all').setDescription('ลบทั้งหมดในห้อง (ลบเป็นรอบๆ)').setRequired(false));
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
    // เริ่มเก็บ log ก่อนทำอย่างอื่น เพื่อให้ปัญหาตอนสตาร์ทถูกบันทึกไว้ด้วย
    startLogStore();

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
