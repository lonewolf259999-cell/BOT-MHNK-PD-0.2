import { describe, it, expect } from 'vitest';
import { parseDetails } from './bypd.service';

describe('parseDetails — ค่าว่างต้องไม่ทำให้รายงานหายทั้งใบ', () => {
    it('หัวข้อมีแต่ไม่มีเนื้อหาตามหลัง → ต้องคง - ไว้ ไม่ปล่อยให้เป็นช่องว่าง', () => {
        // ช่องว่างเปล่าทำให้ Discord ปฏิเสธกล่องรายงานทั้งใบ คดีนั้นจะไม่ถูกส่งเลย
        const d = parseDetails(['คดี :', 'จำคุก :', 'ค่าปรับ :'].join('\n'));
        expect(d.caseInfo).toBe('-');
        expect(d.jail).toBe('-');
        expect(d.fine).toBe('-');
    });

    it('หัวข้อตามด้วยช่องว่างล้วน → ต้องคง - ไว้', () => {
        const d = parseDetails('คดี :    \nจำคุก :   ');
        expect(d.caseInfo).toBe('-');
        expect(d.jail).toBe('-');
    });

    it('ทุกช่องต้องมีตัวหนังสืออย่างน้อย 1 ตัวเสมอ แม้ข้อความต้นทางว่างเปล่า', () => {
        const d = parseDetails('');
        for (const [key, value] of Object.entries(d)) {
            expect(value.length, `ช่อง ${key} ต้องไม่ว่าง`).toBeGreaterThan(0);
        }
    });

    it('มีเนื้อหาปกติ → ต้องอ่านได้ครบ', () => {
        const d = parseDetails([
            'ผู้ต้องหา สมชาย ถูกจับโดย เจ้าหน้าที่ Pita Wpct',
            'เจ้าหน้าที่ Pita Wpct',
            'คดี : ลักทรัพย์',
            'จำคุก : 30 เดือน',
            'ค่าปรับ : 5,000',
            '28/09/2026 - 05:48:22',
        ].join('\n'));

        expect(d.offender).toBe('สมชาย');
        expect(d.officer).toBe('Pita Wpct');
        expect(d.caseInfo).toBe('ลักทรัพย์');
        expect(d.jail).toBe('30 เดือน');
        expect(d.fine).toBe('5,000');
        expect(d.time).toBe('28/09/2026 - 05:48:22');
    });

    it('มีบางช่องว่าง บางช่องมีของ → ช่องที่มีของต้องไม่ถูกกระทบ', () => {
        const d = parseDetails('คดี : ลักทรัพย์\nจำคุก :\nค่าปรับ : 5,000');
        expect(d.caseInfo).toBe('ลักทรัพย์');
        expect(d.jail).toBe('-');
        expect(d.fine).toBe('5,000');
    });

    it('เนื้อหายาวเกิน 1024 ตัวอักษร → ต้องตัดให้พอดี ไม่งั้น Discord ก็ปฏิเสธเหมือนกัน', () => {
        const d = parseDetails(`คดี : ${'ก'.repeat(3000)}`);
        expect(d.caseInfo.length).toBeLessThanOrEqual(1024);
        expect(d.caseInfo.endsWith('…')).toBe(true);
    });

    it('ตัดเครื่องหมายหนาออกก่อนอ่าน', () => {
        const d = parseDetails('**คดี : ลักทรัพย์**');
        expect(d.caseInfo).toBe('ลักทรัพย์');
    });
});
