import { describe, it, expect } from 'vitest';
import { findRowById, ensureUserRow } from './count.service';
import type { TagInfo } from '../../types/discord';

const emptyRows: string[][] = [];

const headerOnlyRows = [
    [],
    [],
    ['ชื่อDC', 'User ID', 'Take2', 'คดีปกติ', 'รถยอด', 'คุมสอบ', 'อุ้มเอ๋อ'],
];

const existingRows = [
    [],
    [],
    ['ชื่อDC', 'User ID', 'Take2', 'คดีปกติ', 'รถยอด', 'คุมสอบ', 'อุ้มเอ๋อ'],
    ['John', '111', '5', '3', '0', '0', '0'],
    ['Alice', '222', '2', '1', '0', '0', '0'],
];

const legacyRows = [
    [],
    [],
    ['ชื่อDC', 'User ID', 'Take2', 'คดีปกติ', 'รถยอด', 'คุมสอบ', 'อุ้มเอ๋อ'],
    ['John', '', '5', '3', '0', '0', '0'],   // No User ID (old format)
];

describe('findRowById', () => {
    it('ควรเจอแถวโดย User ID ตรง', () => {
        const idx = findRowById(existingRows, '111');
        expect(idx).toBe(3);
    });

    it('ควรคืน -1 ถ้าไม่เจอ', () => {
        const idx = findRowById(existingRows, '999');
        expect(idx).toBe(-1);
    });

    it('ควรคืน -1 ถ้า rows ว่าง', () => {
        const idx = findRowById(emptyRows, '111');
        expect(idx).toBe(-1);
    });
});

describe('ensureUserRow', () => {
    it('ควรเจอแถวที่มี User ID ตรง', () => {
        const rows = structuredClone(existingRows) as string[][];
        const tag: TagInfo = { id: '111', nickname: 'John', username: 'john_usr' };
        const idx = ensureUserRow(rows, tag);
        expect(idx).toBe(3);
    });

    it('ควรเจอแถวโดยชื่อ (backward compat) และใส่ User ID ให้', () => {
        const rows = structuredClone(legacyRows) as string[][];
        const tag: TagInfo = { id: '111', nickname: 'John', username: 'john_usr' };
        const idx = ensureUserRow(rows, tag);
        expect(idx).toBe(3);
        expect(rows[3][1]).toBe('111');
    });

    it('ควรสร้างแถวใหม่ถ้าไม่เจอ', () => {
        const rows = structuredClone(headerOnlyRows) as string[][];
        const tag: TagInfo = { id: '333', nickname: 'NewPerson', username: 'new_usr' };
        const idx = ensureUserRow(rows, tag);
        expect(idx).toBe(3);
        expect(rows[3][0]).toBe('NewPerson');
        expect(rows[3][1]).toBe('333');
    });
});
