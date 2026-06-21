import { describe, it, expect } from 'vitest';
import { hasBypdInEmbed } from './bypd.utils';
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
