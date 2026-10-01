import { describe, it, expect } from 'vitest';
import {
    shouldPersist,
    formatSheetTime,
    parseSheetTime,
    countExpiredRows,
} from './logstore.service';

describe('shouldPersist — บรรทัดไหนควรเก็บลงชีต', () => {
    it('ERROR และ WARN เก็บทุกหมวด', () => {
        expect(shouldPersist({ level: 'ERROR', context: 'อะไรก็ได้' })).toBe(true);
        expect(shouldPersist({ level: 'WARN', context: 'BYPD' })).toBe(true);
    });

    it('DEBUG ไม่เก็บลงชีตเลย — ดูจากหน่วยความจำ 24 ชม.พอ', () => {
        expect(shouldPersist({ level: 'DEBUG', context: 'นับเคส' })).toBe(false);
    });

    it('INFO เก็บเฉพาะหมวดที่เป็นเหตุการณ์', () => {
        expect(shouldPersist({ level: 'INFO', context: 'สมัคร' })).toBe(true);
        expect(shouldPersist({ level: 'INFO', context: 'รีโหลด' })).toBe(true);
        expect(shouldPersist({ level: 'INFO', context: 'นับเคส' })).toBe(true);
    });

    it('INFO ของ BYPD ไม่เก็บ — มีหนึ่งบรรทัดต่อหนึ่งคดี ชีตจะอืดภายในเดือนเดียว', () => {
        expect(shouldPersist({ level: 'INFO', context: 'BYPD' })).toBe(false);
    });

    it('หมวดของตัวเองห้ามเก็บเด็ดขาด — ไม่งั้นความพลาดจะวนเข้าคิวตัวเองไม่จบ', () => {
        expect(shouldPersist({ level: 'ERROR', context: 'LOGSTORE' })).toBe(false);
        expect(shouldPersist({ level: 'WARN', context: 'LOGSTORE' })).toBe(false);
        expect(shouldPersist({ level: 'INFO', context: 'LOGSTORE' })).toBe(false);
    });
});

describe('เวลาในชีต — เขียนเป็นเวลาไทยและอ่านกลับได้', () => {
    /** 2026-10-02 00:00:00 UTC = 07:00:00 ตามเวลาไทย */
    const utcMidnight = Date.UTC(2026, 9, 2, 0, 0, 0);

    it('เขียนเป็นเวลาไทย ไม่ใช่เวลาของเครื่องโฮสต์', () => {
        expect(formatSheetTime(utcMidnight)).toBe('2026-10-02 07:00:00');
    });

    it('อ่านกลับได้ค่าเดิม (ไม่เพี้ยนไป 7 ชั่วโมง)', () => {
        expect(parseSheetTime('2026-10-02 07:00:00')).toBe(utcMidnight);
    });

    it('เขียนแล้วอ่านกลับต้องได้เท่าเดิมเสมอ', () => {
        for (const ms of [0, Date.UTC(2026, 0, 1, 16, 59, 59), Date.UTC(2025, 11, 31, 17, 0, 0)]) {
            expect(parseSheetTime(formatSheetTime(ms))).toBe(ms);
        }
    });

    it('รูปแบบที่ Google จัดแสดงเอง (ไม่เติมศูนย์หน้า) ต้องอ่านออกด้วย', () => {
        // ถ้าเซลล์ไหนเคยถูกตีความเป็นค่าวันที่ Google จะคืน "3:47:11" ไม่ใช่ "03:47:11"
        // ตัวอ่านต้องทน ไม่งั้นการลบ log เก่าจะหยุดที่แถวนั้นแล้วไม่ลบอะไรเลย
        expect(parseSheetTime('2026-10-02 3:47:11')).toBe(parseSheetTime('2026-10-02 03:47:11'));
        expect(parseSheetTime('2026-1-2 3:4:5')).toBe(parseSheetTime('2026-01-02 03:04:05'));
    });

    it('ค่าที่อ่านไม่ออก (คนพิมพ์มือ / ว่าง) → คืน null ไม่ใช่เดา', () => {
        expect(parseSheetTime(undefined)).toBeNull();
        expect(parseSheetTime('')).toBeNull();
        expect(parseSheetTime('เมื่อวาน')).toBeNull();
        expect(parseSheetTime('2026-10-02')).toBeNull();
        expect(parseSheetTime('02/10/2026 07:00:00')).toBeNull();
    });
});

describe('countExpiredRows — นับแถวเก่าที่ลบได้', () => {
    const t = (s: string) => [s];
    const HEADER = ['เวลา'];

    it('ชีตมีแต่หัวตาราง → ไม่มีอะไรให้ลบ', () => {
        expect(countExpiredRows([HEADER], Date.now())).toBe(0);
    });

    it('เก่าทั้งหมด → ลบได้ทุกแถวข้อมูล แต่ไม่แตะหัวตาราง', () => {
        const rows = [HEADER, t('2026-01-01 00:00:00'), t('2026-01-02 00:00:00')];
        expect(countExpiredRows(rows, Date.UTC(2026, 5, 1))).toBe(2);
    });

    it('ใหม่ทั้งหมด → ไม่ลบอะไรเลย', () => {
        const rows = [HEADER, t('2026-10-01 00:00:00'), t('2026-10-02 00:00:00')];
        expect(countExpiredRows(rows, Date.UTC(2026, 0, 1))).toBe(0);
    });

    it('เก่าอยู่บน ใหม่อยู่ล่าง → หยุดนับตรงแถวแรกที่ยังไม่เก่า', () => {
        const rows = [
            HEADER,
            t('2026-01-01 00:00:00'),
            t('2026-01-02 00:00:00'),
            t('2026-10-02 00:00:00'),
            t('2026-10-03 00:00:00'),
        ];
        expect(countExpiredRows(rows, Date.UTC(2026, 5, 1))).toBe(2);
    });

    it('เจอแถวที่อ่านเวลาไม่ออก → หยุดทันที ปลอดภัยกว่าเดาแล้วลบของที่ยังต้องใช้', () => {
        const rows = [HEADER, t('2026-01-01 00:00:00'), t('พิมพ์มือ'), t('2026-01-03 00:00:00')];
        expect(countExpiredRows(rows, Date.UTC(2026, 5, 1))).toBe(1);
    });

    it('แถวว่างกลางทาง → หยุดเหมือนกัน ไม่ข้ามไปลบของหลังมัน', () => {
        const rows = [HEADER, t('2026-01-01 00:00:00'), [], t('2026-01-03 00:00:00')];
        expect(countExpiredRows(rows, Date.UTC(2026, 5, 1))).toBe(1);
    });
});
