/**
 * In-memory cache with TTL + max size + LRU eviction.
 * Reduces Google Sheets API calls significantly.
 */
export class MemoryCache {
    private store = new Map<string, { data: unknown; expires: number }>();
    private accessOrder: string[] = [];
    private readonly maxSize: number;

    constructor(maxSize = 500) {
        this.maxSize = maxSize;
    }

    get<T>(key: string): T | null {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.delete(key);
            return null;
        }
        this.updateAccessOrder(key);
        return entry.data as T;
    }

    set(key: string, data: unknown, ttlMs: number): void {
        if (this.store.has(key)) {
            this.updateAccessOrder(key);
        } else {
            // ไล่ทิ้งจนเหลือที่ว่างจริง ๆ — ใช้ while เพราะถ้าคิวกับ store หลุดกันเมื่อไหร่
            // การ shift ครั้งเดียวอาจได้ key ที่ไม่มีใน store แล้ว ลบไปก็ไม่ได้ที่ว่างเพิ่ม
            while (this.store.size >= this.maxSize && this.accessOrder.length > 0) {
                const oldest = this.accessOrder.shift();
                if (oldest !== undefined) this.store.delete(oldest);
            }
            this.accessOrder.push(key);
        }
        this.store.set(key, { data, expires: Date.now() + ttlMs });
    }

    delete(key: string): void {
        this.store.delete(key);
        this.removeFromAccessOrder(key);
    }

    deleteByPrefix(prefix: string): void {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) this.store.delete(key);
        }
        this.accessOrder = this.accessOrder.filter(k => !k.startsWith(prefix));
    }

    clear(): void {
        this.store.clear();
        this.accessOrder = [];
    }

    size(): number {
        return this.store.size;
    }

    /** เอา key ออกจากคิว — ใช้ตอนลบของออกจาก store */
    private removeFromAccessOrder(key: string): void {
        const idx = this.accessOrder.indexOf(key);
        if (idx !== -1) this.accessOrder.splice(idx, 1);
    }

    /**
     * ย้าย key ไปท้ายคิว (= เพิ่งถูกใช้)
     *
     * ห้ามเรียกตัวนี้หลังลบ key ออกจาก store เด็ดขาด เพราะมันจะ push key กลับเข้าคิว
     * ทำให้คิวมี key ที่ไม่มีใน store แล้ว พอถึงเวลา evict จะ shift ได้ key ตายมาลบ
     * ซึ่งไม่ได้ที่ว่างเพิ่มเลย ผลคือ store โตเกิน maxSize ไปเรื่อย ๆ
     */
    private updateAccessOrder(key: string): void {
        this.removeFromAccessOrder(key);
        this.accessOrder.push(key);
    }
}

// Singleton
export const cache = new MemoryCache();