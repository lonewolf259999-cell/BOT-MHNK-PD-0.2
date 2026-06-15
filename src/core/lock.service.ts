import { Mutex } from './mutex';

export const locks = {
    logtime: new Mutex(),
    count: new Mutex(),
    registration: new Mutex(),
    sheetMutation: new Mutex(),
};