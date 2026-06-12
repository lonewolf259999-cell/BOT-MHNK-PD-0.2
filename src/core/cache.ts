/**
 * Simple in-memory cache with TTL support.
 * Reduces Google Sheets API calls significantly.
 */
export class MemoryCache {
    private store = new Map<string, { data: unknown; expires: number }>();

    get<T>(key: string): T | null {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.store.delete(key);
            return null;
        }
        return entry.data as T;
    }

    set(key: string, data: unknown, ttlMs: number): void {
        this.store.set(key, { data, expires: Date.now() + ttlMs });
    }

    delete(key: string): void {
        this.store.delete(key);
    }

    clear(): void {
        this.store.clear();
    }
}

// Singleton
export const cache = new MemoryCache();