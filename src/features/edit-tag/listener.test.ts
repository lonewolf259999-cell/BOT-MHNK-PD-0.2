import { describe, it, expect } from 'vitest';
import { pickErrorReplyMode } from './listener';

const state = (repliable: boolean, replied: boolean, deferred: boolean) => ({ repliable, replied, deferred });

describe('pickErrorReplyMode — เลือกวิธีแจ้งข้อผิดพลาดให้ตรงสถานะ', () => {
    it('ยังไม่ตอบอะไรเลย → ตอบใหม่ได้', () => {
        expect(pickErrorReplyMode(state(true, false, false))).toBe('reply');
    });

    it('บอก "รอแป๊บ" ไปแล้ว → ต้องแก้ข้อความที่ค้างอยู่ ห้ามตอบใหม่', () => {
        // เคสหลักของฟีเจอร์นี้ — บอกรอแป๊บไว้ 5 จุดก่อนเริ่มทำงานจริง
        // ของเดิมใช้วิธี "ตอบใหม่" ตรงนี้ แล้วโดน Discord ปฏิเสธ ข้อความหายเงียบ
        expect(pickErrorReplyMode(state(true, false, true))).toBe('editReply');
    });

    it('ตอบไปแล้ว → ต้องตอบเพิ่ม', () => {
        expect(pickErrorReplyMode(state(true, true, false))).toBe('followUp');
    });

    it('ตอบไปแล้วและเคยบอกรอแป๊บด้วย → ตอบเพิ่ม (ตอบไปแล้วสำคัญกว่า)', () => {
        expect(pickErrorReplyMode(state(true, true, true))).toBe('followUp');
    });

    it('ตอบกลับไม่ได้เลย → ไม่ต้องทำอะไร', () => {
        expect(pickErrorReplyMode(state(false, false, false))).toBe('skip');
        expect(pickErrorReplyMode(state(false, true, true))).toBe('skip');
    });

    it('ทุกสถานะต้องเลือกวิธีได้เสมอ ไม่มีกรณีที่เงียบไปโดยไม่ตั้งใจ', () => {
        for (const repliable of [true, false]) {
            for (const replied of [true, false]) {
                for (const deferred of [true, false]) {
                    const mode = pickErrorReplyMode(state(repliable, replied, deferred));
                    expect(['reply', 'editReply', 'followUp', 'skip']).toContain(mode);
                    if (repliable) expect(mode).not.toBe('skip');
                }
            }
        }
    });
});
