import { Mutex } from './mutex';

export const locks = {
    logtime: new Mutex(),
    /** ใช้ร่วมกันทั้งนับสดและกดนับใหม่ — ห้ามแยกเป็นคนละตัว ไม่งั้นสองระบบเขียนชีตทับกัน */
    count: new Mutex(),
    sheetMutation: new Mutex(),
    bypdSend: new Mutex(),
    carrySend: new Mutex(),
    take2Send: new Mutex(),
    proctorSend: new Mutex(),
};
