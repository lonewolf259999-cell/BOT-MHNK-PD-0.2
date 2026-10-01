import { describe, it, expect } from 'vitest';
import { diffTags, formatAge, planEdit, looksLikeDiscordId } from './listener';
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

describe('formatAge — อายุข้อความแบบอ่านง่าย', () => {
    it('ไม่ถึงชั่วโมง → บอกเป็นนาที', () => {
        expect(formatAge(0)).toBe('0 นาที');
        expect(formatAge(59 * 60 * 1000)).toBe('59 นาที');
    });

    it('เกินชั่วโมง → บอกเป็นชั่วโมงกับนาที', () => {
        expect(formatAge(60 * 60 * 1000)).toBe('1 ชม. 0 นาที');
        expect(formatAge(5 * 60 * 60 * 1000 + 20 * 60 * 1000)).toBe('5 ชม. 20 นาที');
    });

    it('ค่าติดลบ (นาฬิกาเครื่องเพี้ยน) → ต้องไม่ได้ข้อความแปลก ๆ', () => {
        expect(formatAge(-5000)).toBe('0 นาที');
    });
});

describe('planEdit — แก้ข้อความแล้วควรทำอะไรต่อ', () => {
    it('อ่านเนื้อหาไม่ได้ → ห้ามแตะยอดเด็ดขาด', () => {
        // ต้นเหตุที่ยอดในชีตหายเอง: ใบเก่าหลุดแคชเนื้อหา แต่ messageLog ยังจำว่าเคยนับให้ใคร
        // ของเดิมอ่านได้ 0 แท็ก แล้วเหมาว่าแท็กถูกลบ → หักยอดทุกคนทิ้ง
        expect(planEdit(['111', '222'], false, [])).toEqual({ action: 'skip' });
    });

    it('อ่านไม่ได้ ถึงจะเคยนับให้หลายคน ก็ยังต้องไม่มีรายการหักออกมาเลย', () => {
        const plan = planEdit(['111', '222', '333'], false, []);
        expect(plan.action).toBe('skip');
        expect(plan).not.toHaveProperty('removedIds');
    });

    it('ไม่เคยเห็นใบนี้ → จดสถานะไว้เฉย ๆ ไม่นับ', () => {
        expect(planEdit(undefined, true, [A, B])).toEqual({ action: 'record', tagIds: ['111', '222'] });
    });

    it('อ่านได้และเคยเห็น → นับส่วนต่างตามจริง', () => {
        expect(planEdit(['111'], true, [A, B])).toEqual({
            action: 'apply', added: [B], removedIds: [], tagIds: ['111', '222'],
        });
    });

    it('อ่านได้แล้วแท็กถูกเอาออกจริง → หักยอดได้ตามปกติ', () => {
        expect(planEdit(['111', '222'], true, [A])).toEqual({
            action: 'apply', added: [], removedIds: ['222'], tagIds: ['111'],
        });
    });

    it('อ่านได้แล้วแท็กหายหมดจริง → หักทุกคน (ต่างจากกรณีอ่านไม่ได้)', () => {
        expect(planEdit(['111', '222'], true, [])).toEqual({
            action: 'apply', added: [], removedIds: ['111', '222'], tagIds: [],
        });
    });
});

describe('looksLikeDiscordId — กันเลขปลอมไม่ให้สร้างแถวขยะในชีต', () => {
    it('Discord ID จริง (17–20 หลัก) → ผ่าน', () => {
        expect(looksLikeDiscordId('484012084577828875')).toBe(true); // 18 หลัก
        expect(looksLikeDiscordId('12345678901234567')).toBe(true);  // 17 หลัก
        expect(looksLikeDiscordId('12345678901234567890')).toBe(true); // 20 หลัก
    });

    it('เลขสั้นหรือยาวเกิน → ไม่ผ่าน', () => {
        expect(looksLikeDiscordId('123')).toBe(false);
        expect(looksLikeDiscordId('1234567890123456')).toBe(false);   // 16 หลัก
        expect(looksLikeDiscordId('123456789012345678901')).toBe(false); // 21 หลัก
    });

    it('ไม่ใช่ตัวเลขล้วน หรือว่าง → ไม่ผ่าน', () => {
        expect(looksLikeDiscordId('')).toBe(false);
        expect(looksLikeDiscordId('48401208457782887a')).toBe(false);
        expect(looksLikeDiscordId(' 484012084577828875 ')).toBe(false);
    });
});
