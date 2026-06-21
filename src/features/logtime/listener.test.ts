import { describe, it, expect } from 'vitest';
import { extractInfo } from './listener';

describe('extractInfo', () => {
    it('ควรแยกข้อมูลจากข้อความเข้าเวรปกติ', () => {
        const text = [
            'รายงานเข้าเวรของ — Somchai',
            'เวลาเข้างาน 01/01/2026 08:00:00',
            'เวลาออกงาน 01/01/2026 16:00:00',
            'ระยะเวลาที่เข้าเวร',
            '08:00:00',
        ].join('\n');
        const result = extractInfo(text);
        expect(result.name).toBe('Somchai');
        expect(result.inDate).toBe('01/01/2026');
        expect(result.inTime).toBe('08:00:00');
        expect(result.date).toBe('01/01/2026');
        expect(result.time).toBe('16:00:00');
        expect(result.duration).toBe('08:00:00');
    });

    it('ควรแยกข้อมูลจากข้อความที่ใช้คำอื่น (เข้างาน/ออกงาน)', () => {
        const text = [
            'รายงานตัวเข้าเวรของ — TestUser',
            'เข้างาน 15/03/2026 09:30:00',
            'ออกงาน 15/03/2026 17:45:00',
            'รวมเวลา 08:15:00',
        ].join('\n');
        const result = extractInfo(text);
        expect(result.name).toBe('TestUser');
        expect(result.inDate).toBe('15/03/2026');
        expect(result.inTime).toBe('09:30:00');
        expect(result.date).toBe('15/03/2026');
        expect(result.time).toBe('17:45:00');
        expect(result.duration).toBe('08:15:00');
    });

    it('ควรแยก Steam ID ได้', () => {
        const text = [
            'รายงานเข้าเวรของ — Somchai',
            'เวลาเข้างาน 01/01/2026 08:00:00',
            'เวลาออกงาน 01/01/2026 16:00:00',
            'steam:123456',
        ].join('\n');
        const result = extractInfo(text);
        expect(result.id).toBe('steam:123456');
    });

    it('ควรคืนค่า name เป็น null ถ้าไม่ match', () => {
        const result = extractInfo('ข้อความที่ไม่เกี่ยวข้อง');
        expect(result.name).toBeNull();
        expect(result.date).toBeNull();
        expect(result.duration).toBeNull();
    });

    it('ควรจัดการข้อความที่มี backticks หรือเครื่องหมายพิเศษ', () => {
        const text = 'รายงานเข้าเวรของ — `Somchai`\nเวลาเข้างาน **01/01/2026** 08:00:00\nเวลาออกงาน 01/01/2026 16:00:00';
        const result = extractInfo(text);
        expect(result.name).toBe('Somchai');
        expect(result.inDate).toBe('01/01/2026');
    });

    it('ควรใช้ pattern รายงานตัวได้', () => {
        const text = 'รายงานตัว Somchai\nเวลาเข้างาน 01/01/2026 08:00:00\nเวลาออกงาน 01/01/2026 16:00:00';
        const result = extractInfo(text);
        expect(result.name).toBe('Somchai');
    });

    it('ควรใช้ pattern ชื่อได้', () => {
        const text = 'ชื่อ — Somchai\nเวลาเข้างาน 01/01/2026 08:00:00\nเวลาออกงาน 01/01/2026 16:00:00';
        const result = extractInfo(text);
        expect(result.name).toBe('Somchai');
    });
});
