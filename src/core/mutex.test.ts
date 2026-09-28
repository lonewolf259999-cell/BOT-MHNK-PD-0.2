import { describe, it, expect } from 'vitest';
import { Mutex } from './mutex';
import { locks } from './lock.service';

describe('Mutex', () => {
    it('งานช้าต้องกันงานเร็วไว้ก่อน ไม่ทำงานซ้อนกัน', async () => {
        // นี่คือคุณสมบัติที่ทำให้ "นับสด" รอ "กดนับใหม่" จนเสร็จก่อนค่อยเขียนชีต
        const m = new Mutex();
        const order: string[] = [];
        const task = (name: string, ms: number) => m.run(async () => {
            order.push(`${name}-เริ่ม`);
            await new Promise(r => setTimeout(r, ms));
            order.push(`${name}-จบ`);
        });

        await Promise.all([task('นับใหม่', 30), task('นับสด1', 1), task('นับสด2', 1)]);

        expect(order).toEqual([
            'นับใหม่-เริ่ม', 'นับใหม่-จบ',
            'นับสด1-เริ่ม', 'นับสด1-จบ',
            'นับสด2-เริ่ม', 'นับสด2-จบ',
        ]);
    });

    it('งานพังต้องปล่อยกุญแจคืน ไม่ล็อกค้างถาวร', async () => {
        // ถ้าไม่ปล่อยคืน นับใหม่พังทีเดียว ระบบนับจะตายถาวรจนกว่าจะรีสตาร์ท
        const m = new Mutex();
        await expect(m.run(async () => { throw new Error('พัง'); })).rejects.toThrow('พัง');
        await expect(m.run(async () => 'ok')).resolves.toBe('ok');
    });

    it('ต้องคืนค่าที่งานส่งกลับมา', async () => {
        const m = new Mutex();
        await expect(m.run(async () => 42)).resolves.toBe(42);
    });

    it('เข้าคิวตามลำดับที่เรียก', async () => {
        const m = new Mutex();
        const done: number[] = [];
        await Promise.all([1, 2, 3, 4, 5].map(n => m.run(async () => { done.push(n); })));
        expect(done).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('lock.service', () => {
    it('นับสดกับกดนับใหม่ต้องใช้กุญแจตัวเดียวกัน', () => {
        // ของเดิมแยกเป็น count กับ countBatch จึงไม่ได้กันกันเลย
        // ถ้าวันหลังมีคนเผลอเพิ่มกุญแจตัวที่สองสำหรับการนับ เทสนี้จะเตือน
        const countLocks = Object.keys(locks).filter(k => k.toLowerCase().startsWith('count'));
        expect(countLocks).toEqual(['count']);
    });
});
