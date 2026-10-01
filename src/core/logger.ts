/**
 * Structured logger - no external dependencies.
 *
 * ออกหน้าจอ (stdout) เสมอ และเขียนไฟล์ได้ถ้าเปิดไว้
 *  - เขียนไฟล์ผ่าน WriteStream แบบ async  → ไม่บล็อก event loop เหมือน appendFileSync
 *  - มีเพดานขนาดไฟล์ → log ไม่โตจนดิสก์เต็ม
 *  - ปิดการเขียนไฟล์ได้ด้วย LOG_TO_FILE=false (แนะนำบนโฮสต์ ให้แพลตฟอร์มเก็บ log จาก stdout แทน)
 *  - เก็บบรรทัดล่าสุดไว้ในหน่วยความจำด้วย เพื่อให้หน้าเว็บมาขอดูย้อนหลังได้ (ดู recent())
 *
 * วิธีคุมขนาด: ใช้ 2 ไฟล์สลับกัน (app.log ↔ app.log.1)
 * พอไฟล์ที่ใช้อยู่เต็มเพดาน ก็ย้ายไปเขียนอีกไฟล์โดยเริ่มใหม่ทับของเก่า
 * ไม่มีการ rename ไฟล์ที่ยังเปิดค้างอยู่ จึงไม่มีจังหวะที่ข้อมูลหายหรือย้ายไม่สำเร็จบน Windows
 * พื้นที่สูงสุดที่ใช้ = MAX_FILE_BYTES × 2
 */

import fs from 'fs';
import path from 'path';
import { env, LOG } from '../config';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

/** หนึ่งบรรทัดของ log ในรูปแบบที่เอาไปแสดงบนหน้าเว็บได้ตรง ๆ */
export interface LogEntry {
    /** เวลาแบบ epoch ms — เรียง/กรองง่ายกว่าข้อความ */
    at: number;
    level: LogLevel;
    context: string;
    message: string;
    meta?: Record<string, unknown>;
}

const LOG_DIR = path.join(__dirname, '../../logs');
const FILES = [path.join(LOG_DIR, 'app.log'), path.join(LOG_DIR, 'app.log.1')];

let stream: fs.WriteStream | null = null;
let active = -1;          // -1 = ยังไม่ได้เลือกว่าจะเขียนไฟล์ไหน
let bytesWritten = 0;
let fileDisabled = !env.logToFile;

/** ตอนบอทเพิ่งสตาร์ท ให้เขียนต่อจากไฟล์ที่ถูกแตะล่าสุด จะได้ไม่ทับ log ที่ยังใหม่อยู่ */
function pickActive(): number {
    try {
        const mtime = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);
        return mtime(FILES[1]) > mtime(FILES[0]) ? 1 : 0;
    } catch {
        return 0;
    }
}

function newStream(file: string, flags: 'a' | 'w'): fs.WriteStream {
    const s = fs.createWriteStream(file, { flags });
    // ถ้าเขียนไฟล์พังด้วยเหตุใดก็ตาม ให้เลิกเขียนไฟล์ไปเลย — ห้ามทำให้บอทล้ม
    s.on('error', () => { fileDisabled = true; stream = null; });
    return s;
}

function openStream(): fs.WriteStream | null {
    if (fileDisabled) return null;
    if (stream) return stream;
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (active === -1) active = pickActive();
        bytesWritten = fs.existsSync(FILES[active]) ? fs.statSync(FILES[active]).size : 0;
        stream = newStream(FILES[active], 'a');
        return stream;
    } catch {
        fileDisabled = true;
        return null;
    }
}

function writeToFile(line: string): void {
    if (fileDisabled) return;
    let s = openStream();
    if (!s) return;

    const size = Buffer.byteLength(line, 'utf8');
    if (bytesWritten + size > LOG.MAX_FILE_BYTES) {
        try {
            s.end();                              // ปิดไฟล์เดิม ปล่อยให้ flush ของมันเองจนจบ
            active = 1 - active;                  // สลับไปอีกไฟล์
            s = stream = newStream(FILES[active], 'w'); // 'w' = เริ่มใหม่ทับของเก่า
            bytesWritten = 0;
        } catch {
            fileDisabled = true;
            return;
        }
    }
    s.write(line);
    bytesWritten += size;
}

// ---------------------------------------------------------------------------
// กรองความลับออกก่อนเก็บ
// ---------------------------------------------------------------------------

/**
 * ตัดความลับออกจากข้อความ log
 *
 * ข้อความ error จาก Google หรือ Discord ลากคีย์/โทเคนติดมาด้วยได้
 * ถ้าปล่อยไว้ ความลับจะไปโผล่ในชีตและบนหน้าเว็บที่คนอื่นเปิดดูได้
 * จึงต้องกรองที่ "ทางเข้า" ไม่ใช่ตอนแสดงผล — เก็บลงไปแล้วก็สายเกินไป
 */
export function redact(text: string): string {
    return text
        // กุญแจ PEM ของ Google (private_key)
        .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[ตัดกุญแจออก]')
        // โทเคนบอท Discord — 3 ท่อนคั่นด้วยจุด
        .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{25,}\b/g, '[ตัดโทเคนออก]')
        // ค่าที่มาคู่กับชื่อที่บ่งว่าเป็นความลับ เช่น token=..., api_key: ..., Authorization: Bearer ...
        // ต้องกิน "Bearer"/"Basic" ที่คั่นอยู่ด้วย ไม่งั้นจะตัดแค่คำนั้นแล้วปล่อยตัวโทเคนหลุดต่อท้าย
        .replace(/\b(token|secret|password|api[_-]?key|private[_-]?key|authorization)\b\s*[:=]\s*(?:bearer\s+|basic\s+)?\S+/gi,
            (_m, name: string) => `${name}=[ตัดออก]`)
        // Bearer <ค่า> ที่โผล่มาลอย ๆ ไม่มีชื่อหัวข้อนำหน้า
        .replace(/\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [ตัดออก]');
}

function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!meta) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) {
        out[k] = typeof v === 'string' ? redact(v) : v;
    }
    return out;
}

// ---------------------------------------------------------------------------
// ที่เก็บบรรทัดล่าสุดในหน่วยความจำ
// ---------------------------------------------------------------------------

/**
 * วงเก็บบรรทัดล่าสุด — ให้หน้าเว็บมาขอดูได้โดยไม่ต้องเปิดหน้าโฮสต์
 *
 * เลือกเก็บในหน่วยความจำ ไม่ใช่อ่านจากไฟล์ เพราะบนโฮสต์ปิดการเขียนไฟล์ไว้ (LOG_TO_FILE=false)
 * ที่ปริมาณจริงราว 2,500–5,000 บรรทัด/วัน × ~113 ไบต์ = ไม่ถึง 1 MB สำหรับ 24 ชั่วโมง
 * จึงถูกกว่าการเก็บลงชีตมาก และไม่กินโควต้า Google เลย
 *
 * มีเพดาน 2 ชั้น: ตามอายุ (BUFFER_HOURS) และตามจำนวน (BUFFER_MAX_LINES)
 * ชั้นจำนวนมีไว้กันกรณีมี error วนรัว ๆ แล้วหน่วยความจำบวมจนบอทตาย
 */
const buffer: LogEntry[] = [];

function pushToBuffer(entry: LogEntry): void {
    buffer.push(entry);

    const cutoff = entry.at - LOG.BUFFER_HOURS * 60 * 60 * 1000;
    let drop = 0;
    while (drop < buffer.length && buffer[drop].at < cutoff) drop++;
    if (buffer.length - drop > LOG.BUFFER_MAX_LINES) {
        drop = buffer.length - LOG.BUFFER_MAX_LINES;
    }
    if (drop > 0) buffer.splice(0, drop);
}

/** ตัวกรองของ recent() — ทุกช่องไม่ใส่ก็ได้ */
export interface RecentQuery {
    /** เอาเฉพาะระดับเหล่านี้ */
    levels?: LogLevel[];
    /** เอาเฉพาะหมวดนี้ (เทียบแบบไม่สนตัวพิมพ์ใหญ่เล็ก) */
    context?: string;
    /** มีคำนี้อยู่ในข้อความหรือหมวดไหม */
    search?: string;
    /** เอาเฉพาะที่ใหม่กว่าเวลานี้ (epoch ms) */
    since?: number;
    /** เอาท้ายสุดกี่บรรทัด */
    limit?: number;
}

/**
 * บรรทัดล่าสุดที่ยังอยู่ในหน่วยความจำ (ใหม่สุดอยู่ท้าย)
 * กรองก่อนแล้วค่อยตัดจำนวน เพื่อให้ limit นับจากผลที่กรองแล้ว ไม่ใช่ก่อนกรอง
 */
export function recent(q: RecentQuery = {}): LogEntry[] {
    const needle = q.search ? q.search.toLowerCase() : '';
    const ctx = q.context ? q.context.toLowerCase() : '';

    const matched = buffer.filter((e) => {
        if (q.levels && q.levels.length > 0 && !q.levels.includes(e.level)) return false;
        if (q.since !== undefined && e.at < q.since) return false;
        if (ctx && e.context.toLowerCase() !== ctx) return false;
        if (needle) {
            const hay = `${e.context} ${e.message} ${e.meta ? JSON.stringify(e.meta) : ''}`.toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });

    const limit = q.limit && q.limit > 0 ? Math.min(q.limit, LOG.API_MAX_LINES) : LOG.API_MAX_LINES;
    return matched.slice(-limit);
}

/** จำนวนบรรทัดที่เก็บอยู่ และช่วงเวลาที่ครอบคลุม — ใช้บอกสถานะบนหน้าเว็บ */
export function bufferStats(): { lines: number; oldest: number | null; newest: number | null } {
    return {
        lines: buffer.length,
        oldest: buffer.length > 0 ? buffer[0].at : null,
        newest: buffer.length > 0 ? buffer[buffer.length - 1].at : null,
    };
}

// ---------------------------------------------------------------------------
// ผู้รับช่วงต่อ (ตัวเขียนลงชีต)
// ---------------------------------------------------------------------------

type Listener = (entry: LogEntry) => void;
const listeners: Listener[] = [];

/**
 * ให้โมดูลอื่นมารับ log ต่อได้ (ใช้โดย logstore.service ที่เขียนลงชีต)
 *
 * ทำเป็น "ผู้รับช่วง" แทนการให้ logger เรียกตัวเขียนชีตเอง เพื่อไม่ให้ import วนกัน
 * (logger ← sheet.service ← logstore.service → logger)
 */
export function onEntry(fn: Listener): void {
    listeners.push(fn);
}

function log(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): void {
    const now = new Date();
    const ts = now.toISOString();
    const safeMessage = redact(message);
    const safeMeta = redactMeta(meta);
    const metaStr = safeMeta ? ` | ${JSON.stringify(safeMeta)}` : '';
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'INFO' ? '\x1b[36m' : '\x1b[90m';
    const reset = '\x1b[0m';
    // eslint-disable-next-line no-console
    console.log(`${color}[${ts}] [${level}] [${context}] ${safeMessage}${reset}${metaStr}`);
    writeToFile(`[${ts}] [${level}] [${context}] ${safeMessage}${metaStr}\n`);

    const entry: LogEntry = { at: now.getTime(), level, context, message: safeMessage, meta: safeMeta };
    pushToBuffer(entry);

    // ผู้รับช่วงพังก็ห้ามลาก logger ล้มไปด้วย — log คือตัวช่วยไล่ปัญหา ไม่ใช่ตัวสร้างปัญหา
    for (const fn of listeners) {
        try { fn(entry); } catch { /* เงียบไว้ ไม่งั้นจะวนกันเอง */ }
    }
}

export const logger = {
    info: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('INFO', ctx, msg, meta),
    warn: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('WARN', ctx, msg, meta),
    error: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('ERROR', ctx, msg, meta),
    debug: (ctx: string, msg: string, meta?: Record<string, unknown>) => log('DEBUG', ctx, msg, meta),
    /** เรียกตอนปิดระบบ เพื่อให้บรรทัดที่ค้างใน buffer ถูกเขียนลงไฟล์จริง */
    close: (): void => {
        try { stream?.end(); } catch { /* ปิดอยู่แล้ว */ }
        stream = null;
    },
};
