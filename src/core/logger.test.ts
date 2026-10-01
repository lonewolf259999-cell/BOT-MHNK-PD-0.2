import { describe, it, expect } from 'vitest';
import { redact } from './logger';

/*
 * log ถูกเก็บลงชีตและถูกเปิดดูบนหน้าเว็บ จึงต้องกรองความลับออกที่ "ทางเข้า"
 * ถ้ากรองตอนแสดงผล ความลับจะถูกเขียนลงชีตไปแล้ว ซึ่งสายเกินไป
 */

/**
 * ประกอบ "ความลับปลอม" ขึ้นตอนรัน ไม่เขียนเป็นสตริงเดียวในไฟล์
 *
 * ตัวสแกนความลับของ GitHub บล็อกการ push ทันทีที่เจอสตริงซึ่ง "รูปร่างเหมือน"
 * โทเคนจริง ถึงจะเป็นของที่แต่งขึ้นมาเทสก็ตาม — มันแยกไม่ออก และมันทำถูกแล้ว
 *
 * ⚠️ ห้ามรวบกลับเป็นสตริงเดียวเพื่อความสั้น ไม่งั้นจะ push ไม่ผ่านอีก
 *    (เคยเกิดมาแล้วกับ Discord Bot Token ด้านล่าง)
 */
const fake = (...parts: string[]): string => parts.join('');

const PEM_BEGIN = fake('-----', 'BEGIN', ' PRIVATE KEY', '-----');
const PEM_END = fake('-----', 'END', ' PRIVATE KEY', '-----');
const PEM_BODY = fake('ZmFrZS1rZXktYm9keS1m', 'b3ItdGVzdGluZy1vbmx5');

const DISCORD_TOKEN = fake(
    'MTIzNDU2Nzg5', 'MDEyMzQ1Njc4',
    '.', 'GhIjKl',
    '.', 'abcdefghijklmnopqrstuvwxyz', '12345',
);

const GOOGLE_TOKEN = fake('ya29.', 'a0ARrdaM', '-fake-value-for-testing');

describe('redact — กรองความลับออกจากข้อความ log', () => {
    it('กุญแจ Google (PEM) ต้องถูกตัดออกทั้งก้อน', () => {
        const out = redact(`อ่านกุญแจไม่ได้: ${PEM_BEGIN}\n${PEM_BODY}\n${PEM_END}`);
        expect(out).not.toContain(PEM_BODY);
        expect(out).not.toContain(PEM_BEGIN);
        expect(out).toContain('[ตัดกุญแจออก]');
    });

    it('โทเคนบอท Discord ต้องถูกตัดออก', () => {
        const out = redact(`login ล้มเหลวด้วย ${DISCORD_TOKEN}`);
        expect(out).not.toContain(DISCORD_TOKEN);
        expect(out).toContain('[ตัดโทเคนออก]');
    });

    it('ค่าที่มาคู่กับชื่อที่บ่งว่าเป็นความลับ ต้องถูกตัด แต่ชื่อยังอยู่ให้รู้ว่าตัดอะไรไป', () => {
        const out = redact('ส่งคำขอด้วย token=abc123XYZ และ api_key: secret-value-here');
        expect(out).not.toContain('abc123XYZ');
        expect(out).not.toContain('secret-value-here');
        expect(out).toContain('token=[ตัดออก]');
        expect(out).toContain('api_key=[ตัดออก]');
    });

    it('Authorization: Bearer ... ต้องถูกตัด', () => {
        // ของเดิมกินแค่คำว่า Bearer แล้วปล่อยตัวโทเคนหลุดต่อท้าย
        const out = redact(`Authorization: Bearer ${GOOGLE_TOKEN}`);
        expect(out).not.toContain(GOOGLE_TOKEN);
    });

    it('ข้อความปกติต้องไม่ถูกแตะ — ไม่งั้นอ่าน log ไม่รู้เรื่อง', () => {
        const plain = 'นับเพิ่ม 12 หักออก 0 คิวค้าง 3 | ห้อง #คดีปกติ';
        expect(redact(plain)).toBe(plain);
    });

    it('รหัส Discord ของกำลังพลต้องไม่ถูกตัด — เป็นข้อมูลที่ต้องใช้ไล่ปัญหา', () => {
        const text = 'แท็ก 484012084577828875 หาชื่อไม่ได้เลย';
        expect(redact(text)).toContain('484012084577828875');
    });

    it('ข้อความว่างต้องไม่พัง', () => {
        expect(redact('')).toBe('');
    });
});
