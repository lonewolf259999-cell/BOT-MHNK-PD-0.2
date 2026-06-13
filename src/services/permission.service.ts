/**
 * Permission service — centralized permission checking.
 * Reads allowed role IDs from configService (which reads from Google Sheet).
 */
export class PermissionService {
    /**
     * Check if a member has any of the allowed roles for editing tags.
     */
    static hasAllowedEditTagRole(member: any): boolean {
        // TODO: หลังจากทำ ข้อ 2 จะอ่านจาก configService.getThirtyDayConfig().exemptRoles
        // ตอนนี้ใช้ hardcode เหมือนเดิมก่อน
        const exemptRoles = ['1507105753461424198', '1507570062649983027', '1507107833890738347'];
        return member?.roles?.cache?.some((r: any) => exemptRoles.includes(r.id)) ?? false;
    }

    /**
     * Check if member has Administrator permission.
     */
    static isAdmin(member: any): boolean {
        return member?.permissions?.has('Administrator') ?? false;
    }

    /**
     * Check if the interaction user is tagged in the target message.
     */
    static isMessageOwner(interaction: any, targetMessage: any): boolean {
        const content = targetMessage.content || '';
        return content.includes(`<@${interaction.user.id}>`) || content.includes(`<@!${interaction.user.id}>`);
    }

    /**
     * Full check: owner OR allowed role OR admin.
     */
    static canEditTag(interaction: any, targetMessage: any): boolean {
        return this.isMessageOwner(interaction, targetMessage)
            || this.hasAllowedEditTagRole(interaction.member)
            || this.isAdmin(interaction.member);
    }
}