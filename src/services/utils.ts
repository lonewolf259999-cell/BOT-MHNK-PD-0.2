/** Shared utility functions */

export function normalizeName(str: string): string {
    return (str || '').trim().toLowerCase();
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Column letter to index (A=0, B=1, ...)
 */
export function colToIndex(col: string): number {
    let index = 0;
    for (let i = 0; i < col.length; i++) {
        index = index * 26 + (col.charCodeAt(i) - 64);
    }
    return index - 1;
}

/**
 * Extract Discord User ID from a cell that may contain `<@ID>` or just `ID`
 */
export function extractUserId(cell: string): string | null {
    if (!cell) return null;
    const match = String(cell).match(/\d{17,19}/);
    return match ? match[0] : null;
}