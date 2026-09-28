import fs from 'fs';
import path from 'path';

export interface CredentialsFile {
    client_email: string;
    private_key: string;
    type: string;
    project_id: string;
    private_key_id: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
    auth_provider_x509_cert_url: string;
    client_x509_cert_url: string;
    universe_domain: string;
}

const ENV_KEY = 'GOOGLE_JSON_KEY';
export const CREDENTIALS_PATH = path.join(__dirname, '../../credentials.json');

function parseCredentials(raw: string, source: string): CredentialsFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`${source} ไม่ใช่ JSON ที่ถูกต้อง: ${e instanceof Error ? e.message : String(e)}`);
    }

    const keys = parsed as Partial<CredentialsFile>;
    if (!keys.client_email) throw new Error(`${source} ไม่มีฟิลด์ client_email`);
    if (!keys.private_key) throw new Error(`${source} ไม่มีฟิลด์ private_key`);

    // บางโฮสต์เก็บค่าโดยที่ \n ยังเป็นตัวอักษรสองตัว ไม่ใช่การขึ้นบรรทัดจริง
    // ถ้าปล่อยไว้ Google จะปฏิเสธกุญแจโดยไม่บอกสาเหตุที่ชัดเจน
    const privateKey = keys.private_key.includes('\n')
        ? keys.private_key
        : keys.private_key.replace(/\\n/g, '\n');

    return { ...(keys as CredentialsFile), private_key: privateKey };
}

/**
 * อ่านกุญแจ Google
 *
 * ลำดับ: ใช้ GOOGLE_JSON_KEY จาก .env ก่อน — ถ้าไม่มีค่อยใช้ไฟล์ credentials.json
 * แบบ .env สะดวกกว่าเวลาย้ายโฮสต์ เพราะไม่ต้องอัปโหลดไฟล์แยก แก้ที่เดียวจบ
 */
export function loadCredentials(): CredentialsFile {
    const fromEnv = (process.env[ENV_KEY] || '').trim();
    if (fromEnv) return parseCredentials(fromEnv, ENV_KEY);

    if (!fs.existsSync(CREDENTIALS_PATH)) {
        throw new Error(
            `ไม่พบกุญแจ Google — ใส่ ${ENV_KEY} ใน .env (แนะนำ) หรือวางไฟล์ credentials.json ที่ ${CREDENTIALS_PATH}`,
        );
    }
    return parseCredentials(fs.readFileSync(CREDENTIALS_PATH, 'utf8'), 'credentials.json');
}

/** ตรวจกุญแจโดยไม่โยน error — ใช้ตอนบอทสตาร์ทเพื่อรวม error ทุกจุดไว้ด้วยกัน */
export function checkCredentials(): string[] {
    try {
        loadCredentials();
        return [];
    } catch (e) {
        return [`❌ ${e instanceof Error ? e.message : String(e)}`];
    }
}

/** บอกว่ากุญแจที่ใช้อยู่มาจากไหน — ใช้แสดงตอนบอทเริ่มทำงาน */
export function credentialsSource(): string {
    return (process.env[ENV_KEY] || '').trim() ? ENV_KEY : 'credentials.json';
}
