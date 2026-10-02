import { describe, it, expect } from 'vitest';
import {
    shouldPersist,
    formatSheetTime,
    countRowsToDrop,
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

describe('เวลาในชีต — เขียนเป็นเวลาไทย', () => {
    /** 2026-10-02 00:00:00 UTC = 07:00:00 ตามเวลาไทย */
    const utcMidnight = Date.UTC(2026, 9, 2, 0, 0, 0);

    it('เขียนเป็นเวลาไทย ไม่ใช่เวลาของเครื่องโฮสต์', () => {
        expect(formatSheetTime(utcMidnight)).toBe('2026-10-02 07:00:00');
    });

    it('เรียงตามตัวอักษรได้ผลเท่ากับเรียงตามเวลา — ทำให้แถวบนเก่าสุดเสมอ', () => {
        const a = formatSheetTime(Date.UTC(2026, 0, 1, 16, 59, 59));
        const b = formatSheetTime(Date.UTC(2026, 9, 2, 0, 0, 0));
        expect(a < b).toBe(true);
    });
});

describe('countRowsToDrop — เกินเพดานกี่แถว (ตัดจากบน)', () => {
    const t = (s: string) => [s];
    const HEADER = ['เวลา'];
    const rowsOf = (n: number) => [HEADER, ...Array.from({ length: n }, (_, i) => t('row' + i))];

    it('ชีตมีแต่หัวตาราง → ไม่มีอะไรให้ลบ', () => {
        expect(countRowsToDrop([HEADER], 100)).toBe(0);
    });

    it('ชีตว่างเปล่าจริง ๆ (ยังไม่มีหัวตาราง) → ไม่ติดลบ', () => {
        expect(countRowsToDrop([], 100)).toBe(0);
    });

    it('ยังไม่ถึงเพดาน → ไม่ลบ', () => {
        expect(countRowsToDrop(rowsOf(99), 100)).toBe(0);
    });

    it('เท่าเพดานพอดี → ยังไม่ลบ', () => {
        expect(countRowsToDrop(rowsOf(100), 100)).toBe(0);
    });

    it('เกินเพดาน → ลบเท่าส่วนที่เกิน เหลือเท่าเพดานพอดี', () => {
        expect(countRowsToDrop(rowsOf(101), 100)).toBe(1);
        expect(countRowsToDrop(rowsOf(350), 100)).toBe(250);
    });

    it('ไม่นับหัวตารางเป็นข้อมูล — ไม่งั้นจะลบเกินไปหนึ่งแถวทุกครั้ง', () => {
        // 101 แถวในชีต = หัวตาราง 1 + ข้อมูล 100 → ยังไม่เกินเพดาน 100
        expect(rowsOf(100).length).toBe(101);
        expect(countRowsToDrop(rowsOf(100), 100)).toBe(0);
    });

    it('เพดาน 0 หรือติดลบ → ถือว่าปิดการลบ ไม่ใช่ลบทิ้งทั้งแท็บ', () => {
        expect(countRowsToDrop(rowsOf(500), 0)).toBe(0);
        expect(countRowsToDrop(rowsOf(500), -5)).toBe(0);
    });

    it('ไม่สนใจเนื้อในเซลล์เลย — แถวที่อ่านเวลาไม่ออกก็ยังนับได้', () => {
        // จุดสำคัญของการเปลี่ยนมาตัดตามจำนวนแถว: ของเดิมจะหยุดที่แถวแบบนี้แล้วไม่ลบอะไรอีก
        const rows = [HEADER, t('พิมพ์มือ'), [], t('2026-10-02 00:00:00')];
        expect(countRowsToDrop(rows, 2)).toBe(1);
    });
});
