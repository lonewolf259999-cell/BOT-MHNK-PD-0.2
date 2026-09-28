import { describe, it, expect } from 'vitest';
import { isStalePanelLabel } from './listener';

describe('isStalePanelLabel', () => {
    it('ปุ่มเขียนว่าหยุด แต่ไม่มีงานทำอยู่ = แผงค้าง', () => {
        // เคสบอทรีสตาร์ทระหว่างนับ: สถานะในหน่วยความจำหาย แต่ข้อความแผงในห้องยังเป็นของเดิม
        expect(isStalePanelLabel('⏹️ หยุดทำงาน', false)).toBe(true);
    });

    it('ปุ่มเขียนว่าหยุด และมีงานทำอยู่จริง = ปกติ ต้องหยุดงานให้', () => {
        expect(isStalePanelLabel('⏹️ หยุดทำงาน', true)).toBe(false);
    });

    it('ปุ่มเขียนว่าเริ่ม = ปกติ ไม่ใช่แผงค้าง', () => {
        expect(isStalePanelLabel('⭐ เริ่มนับข้อความเก่า', false)).toBe(false);
        expect(isStalePanelLabel('🔄 ส่งย้อนหลัง BYPD', false)).toBe(false);
    });

    it('อ่านป้ายปุ่มไม่ได้ = ถือว่าปกติ ไม่ไปขวางการใช้งาน', () => {
        expect(isStalePanelLabel(null, false)).toBe(false);
        expect(isStalePanelLabel(undefined, false)).toBe(false);
        expect(isStalePanelLabel('', false)).toBe(false);
    });
});
