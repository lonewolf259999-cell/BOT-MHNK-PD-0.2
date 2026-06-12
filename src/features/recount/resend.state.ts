/**
 * In-memory state tracker for resend operations.
 * Same concept as resendState.js in v0.1
 */

interface ResendState {
    isRunning: boolean;
    abortController: AbortController | null;
    totalSent: number;
    totalFailed: number;
}

const states = new Map<string, ResendState>();

export const resendStates = {
    get(guildId: string): ResendState | undefined {
        return states.get(guildId);
    },

    set(guildId: string, state: ResendState): void {
        states.set(guildId, state);
    },

    isRunning(guildId: string): boolean {
        return states.get(guildId)?.isRunning ?? false;
    },

    stop(guildId: string): void {
        const state = states.get(guildId);
        if (state?.abortController) {
            state.abortController.abort();
        }
        states.set(guildId, { isRunning: false, abortController: null, totalSent: 0, totalFailed: 0 });
    },
};