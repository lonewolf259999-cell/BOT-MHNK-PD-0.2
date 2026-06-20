import { Mutex } from './mutex';

export const locks = {
    logtime: new Mutex(),
    count: new Mutex(),
    sheetMutation: new Mutex(),
    bypdSend: new Mutex(),
};
