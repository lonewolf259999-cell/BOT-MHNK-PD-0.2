import { describe, it, expect } from 'vitest';
import { parseHours } from './config.service';

describe('parseHours — อ่านค่าชั่วโมงจากชีตตั้งค่า', () => {
    it('ไม่ได้ใส่ค่า → ใช้ค่า default', () => {
        expect(parseHours(undefined, 2)).toBe(2);
        expect(parseHours('', 2)).toBe(2);
        expect(parseHours('   ', 2)).toBe(2);
    });

    it('ใส่เลขปกติ → ใช้ค่านั้น', () => {
        expect(parseHours('6', 2)).toBe(6);
        expect(parseHours(' 0.5 ', 2)).toBe(0.5);
    });

    it('ใส่ 0 = ปิดการแจ้งเตือน ต้องยอมรับ ไม่ใช่ตีเป็นค่าว่าง', () => {
        expect(parseHours('0', 2)).toBe(0);
    });

    it('พิมพ์ผิดหรือติดลบ → ใช้ค่า default ไม่ให้ตรรกะเวลาพัง', () => {
        expect(parseHours('abc', 2)).toBe(2);
        expect(parseHours('-3', 2)).toBe(2);
        expect(parseHours('2 ชม.', 2)).toBe(2);
    });
});
