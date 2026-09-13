/**
 * In-memory state tracker for manual recount operations.
 */

interface CountState {
    isRunning: boolean;
    abortController: AbortController | null;
}

const state: CountState = { isRunning: false, abortController: null };

export const countStates = {
    isRunning(): boolean {
        return state.isRunning;
    },

    start(controller: AbortController): void {
        state.isRunning = true;
        state.abortController = controller;
    },

    stop(): void {
        state.abortController?.abort();
        state.isRunning = false;
        state.abortController = null;
    },
};
