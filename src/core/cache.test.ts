import { describe, it, expect } from 'vitest';
import { MemoryCache } from './cache';

const MINUTE = 60000;
const ALREADY_EXPIRED = -1000; // expires = now - 1000 → หมดอายุทันทีโดยไม่ต้องรอจริง

describe('MemoryCache — TTL', () => {
    it('ควรคืนค่าที่ยังไม่หมดอายุ', () => {
        const c = new MemoryCache(10);
        c.set('k', 'v', MINUTE);
        expect(c.get('k')).toBe('v');
    });

    it('ควรคืน null และลบทิ้งเมื่อหมดอายุ', () => {
        const c = new MemoryCache(10);
        c.set('k', 'v', ALREADY_EXPIRED);
        expect(c.get('k')).toBeNull();
        expect(c.size()).toBe(0);
    });

    it('ควรคืน null ถ้าไม่มี key นั้น', () => {
        const c = new MemoryCache(10);
        expect(c.get('ไม่มี')).toBeNull();
    });
});

describe('MemoryCache — LRU', () => {
    it('ควรไล่ตัวที่ไม่ได้ใช้นานสุดออก ไม่ใช่ตัวที่เพิ่งใช้', () => {
        const c = new MemoryCache(2);
        c.set('a', 1, MINUTE);
        c.set('b', 2, MINUTE);
        c.get('a');            // a กลายเป็นตัวที่ใช้ล่าสุด
        c.set('c', 3, MINUTE); // เต็มแล้ว ต้องไล่ b ออก

        expect(c.get('a')).toBe(1);
        expect(c.get('b')).toBeNull();
        expect(c.get('c')).toBe(3);
        expect(c.size()).toBe(2);
    });

    it('เขียนทับ key เดิมไม่ควรทำให้ของเต็มเพิ่ม', () => {
        const c = new MemoryCache(2);
        c.set('a', 1, MINUTE);
        c.set('a', 2, MINUTE);
        c.set('b', 3, MINUTE);
        expect(c.size()).toBe(2);
        expect(c.get('a')).toBe(2);
    });
});

describe('MemoryCache — ห้ามโตเกิน maxSize', () => {
    it('หลังของหมดอายุแล้วเติมของใหม่ ต้องไม่ทะลุเพดาน', () => {
        const c = new MemoryCache(3);

        // อ่านของที่หมดอายุ — ของเดิม key จะถูก push กลับเข้าคิวทั้งที่ลบออกจาก store แล้ว
        c.set('old', 1, ALREADY_EXPIRED);
        expect(c.get('old')).toBeNull();

        for (const k of ['w', 'x', 'y', 'z']) c.set(k, 1, MINUTE);
        expect(c.size()).toBe(3);
    });

    it('หลังเรียก delete() แล้วเติมของใหม่ ต้องไม่ทะลุเพดาน', () => {
        const c = new MemoryCache(2);
        c.set('a', 1, MINUTE);
        c.delete('a');

        for (const k of ['x', 'y', 'z']) c.set(k, 1, MINUTE);
        expect(c.size()).toBe(2);
    });

    it('สลับหมดอายุ/เติมใหม่หลายรอบ ก็ต้องคาเพดานอยู่', () => {
        const c = new MemoryCache(5);
        for (let round = 0; round < 50; round++) {
            c.set(`exp${round}`, 1, ALREADY_EXPIRED);
            c.get(`exp${round}`);          // หมดอายุ → ถูกลบ
            c.set(`live${round}`, 1, MINUTE);
            expect(c.size()).toBeLessThanOrEqual(5);
        }
    });
});

describe('MemoryCache — deleteByPrefix', () => {
    it('ควรลบเฉพาะ key ที่ขึ้นต้นตรงกัน', () => {
        const c = new MemoryCache(10);
        c.set('sheet:1:A', 1, MINUTE);
        c.set('sheet:1:B', 2, MINUTE);
        c.set('sheet:2:A', 3, MINUTE);
        c.deleteByPrefix('sheet:1:');

        expect(c.get('sheet:1:A')).toBeNull();
        expect(c.get('sheet:1:B')).toBeNull();
        expect(c.get('sheet:2:A')).toBe(3);
        expect(c.size()).toBe(1);
    });

    it('หลัง deleteByPrefix แล้วเติมของใหม่ ต้องไม่ทะลุเพดาน', () => {
        const c = new MemoryCache(3);
        c.set('sheet:1:A', 1, MINUTE);
        c.set('sheet:1:B', 2, MINUTE);
        c.deleteByPrefix('sheet:1:');

        for (const k of ['p', 'q', 'r', 's']) c.set(k, 1, MINUTE);
        expect(c.size()).toBe(3);
    });
});

describe('MemoryCache — clear', () => {
    it('ควรล้างทั้งหมดและยังใช้งานต่อได้ปกติ', () => {
        const c = new MemoryCache(2);
        c.set('a', 1, MINUTE);
        c.set('b', 2, MINUTE);
        c.clear();
        expect(c.size()).toBe(0);

        for (const k of ['x', 'y', 'z']) c.set(k, 1, MINUTE);
        expect(c.size()).toBe(2);
    });
});
