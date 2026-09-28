/**
 * ตัวจำระยะสั้น — กันประมวลผลข้อความเดิมซ้ำภายในช่วงเวลาที่กำหนด
 *
 * เดิมโค้ดชุดนี้ถูกเขียนซ้ำใน BYPD และ Proctor แยกกัน
 */
export function createRecentSet(ttlMs: number) {
    const seen = new Set<string>();
    return {
        /** true = เพิ่งเห็นไปแล้ว ไม่ควรทำซ้ำ · false = ยังไม่เคยเห็น (และจดไว้ให้แล้ว) */
        seenRecently(id: string): boolean {
            if (seen.has(id)) return true;
            seen.add(id);
            const t = setTimeout(() => seen.delete(id), ttlMs);
            // ไม่ให้ timer ตัวนี้กันไม่ให้ process ปิดตัวตอน shutdown
            t.unref?.();
            return false;
        },
        size(): number {
            return seen.size;
        },
    };
}
