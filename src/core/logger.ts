/**
 * Structured logger - no external dependencies.
 *
 * ออกหน้าจอ (stdout) เสมอ และเขียนไฟล์ได้ถ้าเปิดไว้
 *  - เขียนไฟล์ผ่าน WriteStream แบบ async  → ไม่บล็อก event loop เหมือน appendFileSync
 *  - มีเพดานขนาดไฟล์ → log ไม่โตจนดิสก์เต็ม
 *  - ปิดการเขียนไฟล์ได้ด้วย LOG_TO_FILE=false (แนะนำบนโฮสต์ ให้แพลตฟอร์มเก็บ log จาก stdout แทน)
 *
 * วิธีคุมขนาด: ใช้ 2 ไฟล์สลับกัน (app.log ↔ app.log.1)
 * พอไฟล์ที่ใช้อยู่เต็มเพดาน ก็ย้ายไปเขียนอีกไฟล์โดยเริ่มใหม่ทับของเก่า
 * ไม่มีการ rename ไฟล์ที่ยังเปิดค้างอยู่ จึงไม่มีจังหวะที่ข้อมูลหายหรือย้ายไม่สำเร็จบน Windows
 * พื้นที่สูงสุดที่ใช้ = MAX_FILE_BYTES × 2
 */

import fs from 'fs';
import path from 'path';
import { env, LOG } from '../config';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

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

function log(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'INFO' ? '\x1b[36m' : '\x1b[90m';
    const reset = '\x1b[0m';
    // eslint-disable-next-line no-console
    console.log(`${color}[${ts}] [${level}] [${context}] ${message}${reset}${metaStr}`);
    writeToFile(`[${ts}] [${level}] [${context}] ${message}${metaStr}\n`);
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
