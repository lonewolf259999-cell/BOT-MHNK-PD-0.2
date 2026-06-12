/** Shared utility functions */

export function normalizeName(str: string): string {
    return (str || '').trim().toLowerCase();
}

/**
 * Reply ephemeral then auto-delete after delay ms (default 5000).
 * Same pattern as v0.1's ephemeral auto-delete.
 */
export async function replyAndDelete(interaction: any, content: string, delay = 5000): Promise<void> {
    try {
        await interaction.editReply({ content });
        setTimeout(() => interaction.deleteReply().catch(() => {}), delay);
    } catch {}
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