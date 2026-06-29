import { describe, it, expect } from 'vitest';
import { hasBypdInEmbed, hasPdInEmbed } from './bypd.utils';
import type { APIEmbed } from 'discord.js';

describe('hasBypdInEmbed', () => {
    it('ควรเจอ BYPD ใน title', () => {
        const embed: APIEmbed = { title: 'BYPD Report' };
        expect(hasBypdInEmbed(embed)).toBe(true);
    });

    it('ควรเจอ bypd (ตัวเล็ก) ใน description', () => {
        const embed: APIEmbed = { description: 'this is a bypd case' };
        expect(hasBypdInEmbed(embed)).toBe(true);
    });

    it('ควรเจอ ByPd (ผสม) ใน field name', () => {
        const embed: APIEmbed = { fields: [{ name: 'ByPd Case', value: 'detail' }] };
        expect(hasBypdInEmbed(embed)).toBe(true);
    });

    it('ควรเจอ BYPD ใน field value', () => {
        const embed: APIEmbed = { fields: [{ name: 'Case', value: 'BYPD-123' }] };
        expect(hasBypdInEmbed(embed)).toBe(true);
    });

    it('ควรเจอ BYPD ใน footer', () => {
        const embed: APIEmbed = { footer: { text: 'BYPD System' } };
        expect(hasBypdInEmbed(embed)).toBe(true);
    });

    it('ควรคืน false ถ้าไม่มี BYPD', () => {
        const embed: APIEmbed = { title: 'Hello', description: 'world' };
        expect(hasBypdInEmbed(embed)).toBe(false);
    });

    it('ควรคืน false ถ้า embed ว่าง', () => {
        expect(hasBypdInEmbed({})).toBe(false);
    });
});

describe('hasPdInEmbed', () => {
    it('ควรเจอ PD ใน title', () => {
        const embed: APIEmbed = { title: 'PD 123 Report' };
        expect(hasPdInEmbed(embed)).toBe(true);
    });

    it('ควรเจอ PD ใน description', () => {
        const embed: APIEmbed = { description: 'this is pd 45 case' };
        expect(hasPdInEmbed(embed)).toBe(true);
    });

    it('ควรเจอ PD ใน field value', () => {
        const embed: APIEmbed = { fields: [{ name: 'Case', value: 'PD 00 01 02' }] };
        expect(hasPdInEmbed(embed)).toBe(true);
    });

    it('ควรเจอ PD ใน footer', () => {
        const embed: APIEmbed = { footer: { text: 'PD 999' } };
        expect(hasPdInEmbed(embed)).toBe(true);
    });

    it('ควรไม่ชนกับ BYPD (BYPD มี PD ต่อท้าย)', () => {
        const embed: APIEmbed = { title: 'BYPD 33 79' };
        expect(hasPdInEmbed(embed)).toBe(false);
    });

    it('ควรคืน false ถ้าไม่มี PD', () => {
        const embed: APIEmbed = { title: 'Hello', description: 'world' };
        expect(hasPdInEmbed(embed)).toBe(false);
    });

    it('ควรคืน false ถ้า embed ว่าง', () => {
        expect(hasPdInEmbed({})).toBe(false);
    });
});