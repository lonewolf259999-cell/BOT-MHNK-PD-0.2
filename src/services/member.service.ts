import { Guild, GuildMember } from 'discord.js';
import { normalizeName } from './utils';

export function findMemberByNickname(guild: Guild, searchName: string): GuildMember | undefined {
    const search = normalizeName(searchName);
    return guild.members.cache.find(m => {
        const nick = normalizeName(m.nickname || '');
        const display = normalizeName(m.displayName);
        return nick.includes(search) || display.includes(search);
    });
}

export function findMemberByCode(guild: Guild, code: string): GuildMember | undefined {
    const prefix = `${code} [MHNK-PD]`;
    return guild.members.cache.find(m => (m.nickname || '').startsWith(prefix));
}

export function findMembersByCode(guild: Guild, codes: string[]): { found: GuildMember[]; notFound: string[] } {
    const found: GuildMember[] = [];
    const notFound: string[] = [];
    for (const code of codes) {
        const prefix = `${code} [MHNK-PD]`;
        const matches = guild.members.cache.filter(m => (m.nickname || '').startsWith(prefix));
        if (matches.size > 0) {
            for (const [, m] of matches) {
                if (!found.some(f => f.id === m.id)) found.push(m);
            }
        } else {
            notFound.push(code);
        }
    }
    return { found, notFound };
}

export function truncateNickname(fullName: string, maxLen = 32): string {
    if (fullName.length <= maxLen) return fullName;
    const prefixMatch = fullName.match(/^(.+? \[MHNK-PD\] )/);
    if (prefixMatch) {
        const prefix = prefixMatch[1];
        const icPart = fullName.slice(prefix.length);
        const available = maxLen - prefix.length;
        if (available > 0) return prefix + icPart.slice(0, available);
    }
    return fullName.slice(0, maxLen);
}

export function stripPrefix(name: string): string {
    if (!name) return name;
    return name.replace(/^\d+\s*\[MHNK-PD\]\s*/i, '').trim();
}

export function makeFullName(codeNumber: string, icName: string): string {
    return `${codeNumber} [MHNK-PD] ${icName}`;
}