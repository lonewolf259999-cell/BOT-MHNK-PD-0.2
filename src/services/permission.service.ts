/**
 * Permission service — centralized permission checking.
 * Reads allowed role IDs from configService (which reads from Google Sheet).
 */
export class PermissionService {
    /**
     * Role IDs ที่มีสิทธิ์แก้ไขแท็กในคดี (ตรงกับ EXEMPT_ROLES ใน 30day)
     */
    private static readonly EDIT_TAG_ROLES = ['1507105753461424198', '1507570062649983027', '1507107833890738347'];

    /**
     * Check if a member has any of the allowed roles for editing tags.
     */
    static hasAllowedEditTagRole(member: any): boolean {
        return member?.roles?.cache?.some((r: any) => PermissionService.EDIT_TAG_ROLES.includes(r.id)) ?? false;
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