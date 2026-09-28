import { describe, it, expect } from 'vitest';
import { extractErrorInfo, isRetryableError, retryDelayMs } from './sheet.service';

describe('extractErrorInfo — แกะ error ที่ Google โยนมา', () => {
    it('ดึง status จาก response.status ได้', () => {
        expect(extractErrorInfo({ response: { status: 429 } })).toEqual({ status: 429, code: undefined });
    });

    it('ดึง code ระดับ socket ได้', () => {
        expect(extractErrorInfo({ code: 'ECONNRESET' })).toEqual({ status: undefined, code: 'ECONNRESET' });
    });

    it('ได้ทั้งสองอย่างถ้ามีทั้งคู่', () => {
        expect(extractErrorInfo({ response: { status: 503 }, code: 'ETIMEDOUT' }))
            .toEqual({ status: 503, code: 'ETIMEDOUT' });
    });

    it('Error ธรรมดาที่ไม่มีอะไรเลย → ว่างทั้งคู่ ไม่พัง', () => {
        expect(extractErrorInfo(new Error('อะไรก็ไม่รู้'))).toEqual({ status: undefined, code: undefined });
    });

    it('null / undefined / string → ว่างทั้งคู่ ไม่พัง', () => {
        expect(extractErrorInfo(null)).toEqual({ status: undefined, code: undefined });
        expect(extractErrorInfo(undefined)).toEqual({ status: undefined, code: undefined });
        expect(extractErrorInfo('พังเฉย ๆ')).toEqual({ status: undefined, code: undefined });
    });

    it('response เป็น null → ไม่พยายามอ่าน status ต่อ', () => {
        expect(extractErrorInfo({ response: null })).toEqual({ status: undefined, code: undefined });
    });

    it('code ที่ไม่ใช่ string (บางไลบรารีส่งเลขมา) → ไม่เอา', () => {
        expect(extractErrorInfo({ code: 500 })).toEqual({ status: undefined, code: undefined });
    });
});

describe('isRetryableError — ตัดสินว่าควรลองใหม่ไหม', () => {
    it('ไม่มี status = ต่อไม่ติดตั้งแต่แรก → ต้องลองใหม่', () => {
        expect(isRetryableError(undefined, undefined)).toBe(true);
    });

    it('429 / 500 / 503 → ต้องลองใหม่', () => {
        expect(isRetryableError(429)).toBe(true);
        expect(isRetryableError(500)).toBe(true);
        expect(isRetryableError(503)).toBe(true);
    });

    it('เน็ตสะดุดระดับ socket → ต้องลองใหม่', () => {
        expect(isRetryableError(403, 'ECONNRESET')).toBe(true);
        expect(isRetryableError(403, 'ETIMEDOUT')).toBe(true);
    });

    it('400 / 401 / 403 / 404 = เราส่งผิดเอง → ห้ามลองใหม่ (ลองกี่ครั้งก็ได้ผลเดิม)', () => {
        expect(isRetryableError(400)).toBe(false);
        expect(isRetryableError(401)).toBe(false);
        expect(isRetryableError(403)).toBe(false);
        expect(isRetryableError(404)).toBe(false);
    });

    it('502 ไม่อยู่ในรายการ → ไม่ลองใหม่ (บันทึกพฤติกรรมจริงไว้)', () => {
        expect(isRetryableError(502)).toBe(false);
    });
});

describe('retryDelayMs — ถอยห่างขึ้นเรื่อย ๆ', () => {
    it('ไม่มี jitter → 1 วิ, 2 วิ, 4 วิ', () => {
        expect(retryDelayMs(1, 0)).toBe(1000);
        expect(retryDelayMs(2, 0)).toBe(2000);
        expect(retryDelayMs(3, 0)).toBe(4000);
    });

    it('jitter เต็ม 1 → บวกเพิ่มได้สูงสุด 1 วิ', () => {
        expect(retryDelayMs(1, 1)).toBe(2000);
        expect(retryDelayMs(2, 1)).toBe(3000);
        expect(retryDelayMs(3, 1)).toBe(5000);
    });

    it('jitter ครึ่ง → บวกครึ่งวิ', () => {
        expect(retryDelayMs(1, 0.5)).toBe(1500);
    });

    it('ใช้ค่าสุ่มจริง → ต้องอยู่ในช่วงที่คาดไว้เสมอ', () => {
        for (let i = 0; i < 50; i++) {
            const d = retryDelayMs(2);
            expect(d).toBeGreaterThanOrEqual(2000);
            expect(d).toBeLessThan(3000);
        }
    });

    it('รอบหลังต้องนานกว่ารอบก่อนเสมอ แม้สุ่มได้แย่ที่สุด', () => {
        // รอบ n สูงสุด = 1000*2^(n-1) + 1000 ต้องยังน้อยกว่ารอบ n+1 ต่ำสุด
        expect(retryDelayMs(1, 1)).toBeLessThanOrEqual(retryDelayMs(2, 0));
        expect(retryDelayMs(2, 1)).toBeLessThanOrEqual(retryDelayMs(3, 0));
    });
});
