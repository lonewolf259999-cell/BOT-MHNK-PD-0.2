import { describe, it, expect, afterEach } from 'vitest';
import { loadCredentials, checkCredentials, credentialsSource } from './credentials';

const ENV_KEY = 'GOOGLE_JSON_KEY';
const original = process.env[ENV_KEY];

/** กุญแจปลอมสำหรับเทส — ไม่ใช่ของจริง ใช้ตรวจแค่การอ่านค่าเท่านั้น */
const FAKE_KEY_BODY = 'AAAABBBBCCCC';
const fakeCredentials = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    private_key_id: 'test-key-id',
    private_key: `-----BEGIN PRIVATE KEY-----\n${FAKE_KEY_BODY}\n-----END PRIVATE KEY-----\n`,
    client_email: 'test@test-project.iam.gserviceaccount.com',
    client_id: '000000000000000000000',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://example.invalid/cert',
    universe_domain: 'googleapis.com',
    ...overrides,
});

afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
});

describe('loadCredentials — อ่านจาก GOOGLE_JSON_KEY ใน .env', () => {
    it('อ่านกุญแจจาก .env ได้ ไม่ต้องมีไฟล์ credentials.json', () => {
        process.env[ENV_KEY] = fakeCredentials();
        const keys = loadCredentials();
        expect(keys.client_email).toBe('test@test-project.iam.gserviceaccount.com');
        expect(keys.private_key).toContain('BEGIN PRIVATE KEY');
    });

    it('แปลง \\n ในกุญแจเป็นการขึ้นบรรทัดจริง', () => {
        process.env[ENV_KEY] = fakeCredentials();
        const keys = loadCredentials();
        // ต้องเป็นการขึ้นบรรทัดจริง ไม่ใช่ตัวอักษร backslash กับ n
        expect(keys.private_key).not.toContain('\\n');
        expect(keys.private_key.split('\n').length).toBeGreaterThan(2);
    });

    it('ถ้าโฮสต์ส่งค่ามาโดย \\n ยังไม่ถูกแปลง ต้องแปลงให้เอง', () => {
        // เคสนี้เกิดตอนแพลตฟอร์มเก็บค่าแบบตรงตัวโดยไม่ตีความ escape
        process.env[ENV_KEY] = JSON.stringify({
            client_email: 'a@b.iam.gserviceaccount.com',
            private_key: '-----BEGIN PRIVATE KEY-----\\nXYZ\\n-----END PRIVATE KEY-----\\n',
        });
        const keys = loadCredentials();
        expect(keys.private_key).not.toContain('\\n');
        expect(keys.private_key).toContain('\n');
    });

    it('เว้นว่างไว้ = ถือว่าไม่ได้ตั้ง (ไปใช้ไฟล์แทน)', () => {
        process.env[ENV_KEY] = '   ';
        expect(credentialsSource()).toBe('credentials.json');
    });

    it('ตั้งค่าไว้ = บอกได้ว่ากุญแจมาจากไหน', () => {
        process.env[ENV_KEY] = fakeCredentials();
        expect(credentialsSource()).toBe('GOOGLE_JSON_KEY');
    });
});

describe('checkCredentials — ต้องบอกสาเหตุให้ชัด ไม่ใช่พังเฉย ๆ', () => {
    it('กุญแจถูกต้อง → ไม่มี error', () => {
        process.env[ENV_KEY] = fakeCredentials();
        expect(checkCredentials()).toEqual([]);
    });

    it('JSON เสีย → บอกว่าเสียตรงไหน', () => {
        process.env[ENV_KEY] = '{ไม่ใช่ JSON';
        const errors = checkCredentials();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('GOOGLE_JSON_KEY');
        expect(errors[0]).toContain('ไม่ใช่ JSON ที่ถูกต้อง');
    });

    it('ขาด client_email → บอกชื่อฟิลด์ที่ขาด', () => {
        process.env[ENV_KEY] = fakeCredentials({ client_email: undefined });
        expect(checkCredentials()[0]).toContain('client_email');
    });

    it('ขาด private_key → บอกชื่อฟิลด์ที่ขาด', () => {
        process.env[ENV_KEY] = fakeCredentials({ private_key: undefined });
        expect(checkCredentials()[0]).toContain('private_key');
    });
});
