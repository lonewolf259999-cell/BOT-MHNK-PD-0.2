/**
 * Shared types for Discord bot interactions.
 * Centralizes all custom type definitions to avoid duplication.
 */

/**
 * Tag info extracted from a message mention.
 */
export interface TagInfo {
    id: string;
    nickname: string;
    username: string;
}

/**
 * Constants used across features.
 */
export const CONSTANTS = {
    /** Discord embed color presets */
    COLORS: {
        SUCCESS: 0x00c400,
        DANGER: 0xff4444,
        BLUE: 0x3b82f6,
        GREEN: '#3aca1d' as const,
        ORANGE: '#FFA500' as const,
        RED: '#db0042' as const,
        GRAY: '#808080' as const,
        YELLOW_GREEN: '#a0c400' as const,
    },
    /** Count sheet column indices (A=0, B=1, C=2, D=3, E=4, F=5, G=6) */
    COUNT_HEADER: ['ชื่อDC', 'User ID', 'Take2', 'คดีปกติ', 'รถยอด', 'คุมสอบ', 'อุ้มเอ๋อ'],
    /** Data starts at row index 3 (0-based) */
    COUNT_DATA_START: 3,
};