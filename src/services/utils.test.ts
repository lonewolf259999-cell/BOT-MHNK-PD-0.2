import { describe, it, expect } from 'vitest';
import { normalizeName, silentCatch } from './utils';

describe('normalizeName', () => {
    it('ควรตัดช่องว่างและทำให้เป็นตัวเล็ก', () => {
        expect(normalizeName('  SomChai  ')).toBe('somchai');
    });

    it('ควรคืนค่าว่างถ้า input เป็น undefined', () => {
        expect(normalizeName('')).toBe('');
    });

    it('ไม่เปลี่ยนตัวเล็กอยู่แล้ว', () => {
        expect(normalizeName('john')).toBe('john');
    });

    it('ควรตัดช่องว่างตรงกลางไม่หาย', () => {
        expect(normalizeName('  Som  Chai  ')).toBe('som  chai');
    });
});

describe('silentCatch', () => {
    it('ควรคืนฟังก์ชันที่ไม่ throw', () => {
        const catcher = silentCatch('Test');
        expect(() => catcher(new Error('test'))).not.toThrow();
    });

    it('ควรคืนฟังก์ชันที่รับ string error ได้', () => {
        const catcher = silentCatch('Test');
        expect(() => catcher('some error')).not.toThrow();
    });
});
