/**
 * Debug script — ตรวจสอบค่า PENDING config ที่ BOT โหลดมา
 * ใช้รันเพื่อ debug: npx ts-node src/debug/check-pending.ts
 */
async function main() {
    const { configService } = require('../core/config.service');
    await configService.load();

    console.log('=== PENDING CONFIG DEBUG ===');
    console.log('Pending Spreadsheet ID:', configService.getPendingSpreadsheetId());
    console.log('Pending Sheet Name:', configService.getPendingSheetName());
    console.log('Registry Spreadsheet ID:', configService.getRegistryConfig().spreadsheetId);
    console.log('Registry Sheet Name:', configService.getRegistryConfig().sheetName);
    console.log('');

    // ลองอ่าน Pending Sheet
    const { checkPreApproved } = require('../features/welcome/welcome.service');
    const result = await checkPreApproved('bankgiotto');
    console.log('checkPreApproved("bankgiotto"):', JSON.stringify(result, null, 2));
}

main().catch(console.error);