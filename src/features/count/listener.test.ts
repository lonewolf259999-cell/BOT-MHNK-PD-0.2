import { describe, it, expect } from 'vitest';
import { diffTags } from './listener';
import type { TagInfo } from '../../types/discord';

const tag = (id: string): TagInfo => ({ id, nickname: `nick${id}`, username: `user${id}` });

const A = tag('111');
const B = tag('222');
const C = tag('333');

describe('diffTags', () => {
    it('ไม่เคยเห็นข้อความนี้ (undefined) → ต้องไม่นับอะไรเลย', () => {
        // เคสบอทรีสตาร์ท: ความจำหายหมด แล้วมีคนมาแก้ข้อความเก่า
        // ถ้าเหมาว่าแท็กที่เห็นคือของใหม่ทั้งหมด คะแนนจะซ้ำกับที่นับไปแล้ว
        expect(diffTags(undefined, [A, B])).toEqual({ added: [], removedIds: [] });
    });

    it('เคยเห็นแล้วแต่เดิมไม่มีแท็ก → แท็กที่เพิ่มเข้ามานับเป็นของใหม่', () => {
        expect(diffTags([], [A])).toEqual({ added: [A], removedIds: [] });
    });

    it('เพิ่มคนใหม่เข้าไป → นับเฉพาะคนที่เพิ่ม', () => {
        const d = diffTags(['111'], [A, B]);
        expect(d.added).toEqual([B]);
        expect(d.removedIds).toEqual([]);
    });

    it('เอาคนออก → หักเฉพาะคนที่ถูกเอาออก', () => {
        const d = diffTags(['111', '222'], [A]);
        expect(d.added).toEqual([]);
        expect(d.removedIds).toEqual(['222']);
    });

    it('สลับคน → ได้ทั้งเพิ่มและหัก', () => {
        const d = diffTags(['111', '222'], [A, C]);
        expect(d.added).toEqual([C]);
        expect(d.removedIds).toEqual(['222']);
    });

    it('แก้ข้อความแต่แท็กเหมือนเดิม → ต้องไม่ขยับคะแนน', () => {
        expect(diffTags(['111', '222'], [A, B])).toEqual({ added: [], removedIds: [] });
    });

    it('เทียบด้วยรหัส ไม่ใช่ชื่อ — เปลี่ยนชื่อเล่นไม่ควรนับใหม่', () => {
        const renamed: TagInfo = { id: '111', nickname: 'ชื่อใหม่', username: 'user111' };
        expect(diffTags(['111'], [renamed])).toEqual({ added: [], removedIds: [] });
    });

    it('ลบแท็กออกหมด → หักทุกคน', () => {
        const d = diffTags(['111', '222'], []);
        expect(d.added).toEqual([]);
        expect(d.removedIds).toEqual(['111', '222']);
    });

    it('เดิมมีคนซ้ำในรายการ → หักตามที่จำไว้ ไม่ตกหล่น', () => {
        const d = diffTags(['111', '222', '333'], [B]);
        expect(d.removedIds).toEqual(['111', '333']);
    });
});
