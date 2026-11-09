import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';

// Disposable-replica tests start their own loopback mongod. Use MONGOD_PATH when set,
// otherwise the newest installed MongoDB server; tests skip when none is found.
const root = 'C:/Program Files/MongoDB/Server';
const version = name => name.split('.').map(Number);
const newestFirst = (a, b) => { const x = version(a), y = version(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0); return 0; };
function installed() {
    try { return readdirSync(root).filter(name => /^\d+(\.\d+)*$/.test(name)).sort(newestFirst).map(name => path.posix.join(root, name, 'bin/mongod.exe')); }
    catch { return []; }
}
export const mongodBinary = [process.env.MONGOD_PATH, ...installed()].find(candidate => candidate && existsSync(candidate));
