/**
 * In-memory rate limiter.
 * Prevents spam by tracking request counts per key within a time window.
 */
export class RateLimiter {
    private store = new Map<string, { count: number; resetAt: number }>();

    /**
     * Check if an action is allowed.
     * @param key - Unique identifier (e.g. userId)
     * @param limit - Max requests allowed
     * @param windowMs - Time window in milliseconds
     * @returns true if allowed, false if rate limited
     */
    check(key: string, limit: number, windowMs: number): boolean {
        const now = Date.now();
        const entry = this.store.get(key);

        if (!entry || now > entry.resetAt) {
            this.store.set(key, { count: 1, resetAt: now + windowMs });
            return true;
        }

        if (entry.count >= limit) return false;
        entry.count++;
        return true;
    }

    /**
     * Reset rate limit for a specific key.
     */
    reset(key: string): void {
        this.store.delete(key);
    }

    /**
     * Clean up expired entries periodically.
     * Called by setInterval in index.ts.
     */
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (now > entry.resetAt) this.store.delete(key);
        }
    }
}

// Singleton
export const rateLimiter = new RateLimiter();