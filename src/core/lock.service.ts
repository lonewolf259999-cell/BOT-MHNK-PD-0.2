import { Mutex } from './mutex';

export const locks = {
    logtime: new Mutex(),
    count: new Mutex(),
    countBatch: new Mutex(),
    sheetMutation: new Mutex(),
    bypdSend: new Mutex(),
    carrySend: new Mutex(),
    take2Send: new Mutex(),
    proctorSend: new Mutex(),
};
