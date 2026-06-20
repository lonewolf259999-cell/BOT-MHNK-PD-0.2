/**
 * Simple Promise-based Mutex for preventing race conditions.
 * Ensures critical sections run one at a time.
 * Only exposes run() to prevent accidental acquire() without release().
 */
export class Mutex {
    private queue: (() => void)[] = [];
    private locked = false;

    private async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise(resolve => {
            this.queue.push(resolve);
        });
    }

    private release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
        } else {
            this.locked = false;
        }
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}