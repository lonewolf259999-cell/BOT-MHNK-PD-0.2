/** ตรวจว่า embed มีคำว่า BYPD หรือไม่ */
export function hasBypdInEmbed(embed: any): boolean {
    if (embed.title?.toUpperCase().includes('BYPD')) return true;
    if (embed.description?.toUpperCase().includes('BYPD')) return true;
    if (embed.fields?.some((f: any) => f.name?.toUpperCase().includes('BYPD') || f.value?.toUpperCase().includes('BYPD'))) return true;
    if (embed.footer?.text?.toUpperCase().includes('BYPD')) return true;
    return false;
}

/** ตรวจว่าข้อความหรือ embed ใดๆ มี BYPD หรือไม่ */
export function hasBypdInMessage(msg: any): boolean {
    if (msg.content?.toUpperCase().includes('BYPD')) return true;
    return msg.embeds?.some(hasBypdInEmbed) ?? false;
}