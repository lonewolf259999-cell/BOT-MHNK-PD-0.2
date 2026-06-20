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
            this.store.delete(key);
            this.updateAccessOrder(key);
            return null;
        }
        this.updateAccessOrder(key);
        return entry.data as T;
    }

    set(key: string, data: unknown, ttlMs: number): void {
        if (this.store.has(key)) {
            this.updateAccessOrder(key);
        } else {
            if (this.store.size >= this.maxSize) {
                const oldest = this.accessOrder.shift();
                if (oldest) this.store.delete(oldest);
            }
            this.accessOrder.push(key);
        }
        this.store.set(key, { data, expires: Date.now() + ttlMs });
    }

    delete(key: string): void {
        this.store.delete(key);
        this.updateAccessOrder(key);
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

    private updateAccessOrder(key: string): void {
        const idx = this.accessOrder.indexOf(key);
        if (idx !== -1) this.accessOrder.splice(idx, 1);
        this.accessOrder.push(key);
    }
}

// Singleton
export const cache = new MemoryCache();