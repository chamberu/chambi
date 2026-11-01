/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomBytes } from 'node:crypto';
import {
    chmod,
    mkdir,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { BufferJSON, initAuthCreds } from 'baileys';
import type {
    AuthenticationCreds,
    SignalDataSet,
    SignalDataTypeMap,
    SignalKeyStore,
} from 'baileys';
import type { IWhatsAppAuthProvider, WhatsAppAuthLease } from '@chamvi/chat/baileys';

type Deferred<T> = PromiseWithResolvers<T>;

export function deferred<T = void>(): Deferred<T> {
    return Promise.withResolvers<T>();
}

type KeyValues = Map<string, unknown>;

function keyStore(values: KeyValues, trace: string[], hold: () => Promise<void> | undefined): SignalKeyStore {
    return {
        get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
            const found: { [id: string]: SignalDataTypeMap[T] } = {};

            for (const id of ids) {
                const value = values.get(`${type}/${id}`);

                if (value !== undefined) {
                    found[id] = value as SignalDataTypeMap[T];
                }
            }

            return found;
        },
        async set(data: SignalDataSet) {
            trace.push('keys.set');
            await hold();

            for (const [type, entries] of Object.entries(data)) {
                for (const [id, value] of Object.entries(entries ?? {})) {
                    if (value === null) {
                        values.delete(`${type}/${id}`);
                    } else {
                        values.set(`${type}/${id}`, value);
                    }
                }
            }

            trace.push('keys.set:done');
        },
    };
}

export type RecordingAuth = {
    provider: IWhatsAppAuthProvider;
    /** what the provider and its leases did, in order (shared with the fake socket's trace) */
    trace: string[];
    /** the stored signal keys, `<type>/<id>` */
    keys: KeyValues;
    /** how often acquire() ran, and the signals it got */
    signals: AbortSignal[];
    /** the leases handed out */
    leases: WhatsAppAuthLease[];
    /** the next acquire() waits for this (resolve it to hand the lease out); ignores its signal */
    holdAcquire(): Deferred<void>;
    /** the next acquire() rejects with `error` */
    failAcquire(error: unknown): void;
    /** the next keys.set / saveCreds waits for the returned promise */
    holdKeys(): Deferred<void>;
    holdCreds(): Deferred<void>;
};

/**
 * A recording auth provider: every acquire hands out one lease over fresh
 * creds and the shared key map. Persistence is in memory; the trace records
 * acquire, load, saveCreds, keys.set, flush and release.
 */
export function createRecordingAuth(trace: string[] = []): RecordingAuth {
    const keys: KeyValues = new Map();
    const signals: AbortSignal[] = [];
    const leases: WhatsAppAuthLease[] = [];
    let acquireHold: Deferred<void> | undefined;
    let acquireFailure: { error: unknown } | undefined;
    let keysHold: Deferred<void> | undefined;
    let credsHold: Deferred<void> | undefined;
    const creds: AuthenticationCreds = initAuthCreds();

    const provider: IWhatsAppAuthProvider = {
        async acquire(signal) {
            trace.push('acquire');
            signals.push(signal);

            if (acquireFailure) {
                const { error } = acquireFailure;

                acquireFailure = undefined;

                throw error;
            }

            if (acquireHold) {
                const hold = acquireHold;

                acquireHold = undefined;
                await hold.promise;
            }

            trace.push('load');

            const lease: WhatsAppAuthLease = {
                auth: {
                    creds,
                    keys: keyStore(keys, trace, () => {
                        const hold = keysHold;

                        keysHold = undefined;

                        return hold?.promise;
                    }),
                },
                async saveCreds() {
                    trace.push('saveCreds');

                    const hold = credsHold;

                    credsHold = undefined;
                    await hold?.promise;
                    trace.push('saveCreds:done');
                },
                async flush() {
                    trace.push('flush');
                },
                async release() {
                    trace.push('release');
                },
            };

            leases.push(lease);

            return lease;
        },
    };

    return {
        provider,
        trace,
        keys,
        signals,
        leases,
        holdAcquire() {
            acquireHold = deferred();

            return acquireHold;
        },
        failAcquire(error) {
            acquireFailure = { error };
        },
        holdKeys() {
            keysHold = deferred();

            return keysHold;
        },
        holdCreds() {
            credsHold = deferred();

            return credsHold;
        },
    };
}

/** Writes `data` to `path` through a temporary file in the same folder (0600) and a rename. */
async function writeAtomic(path: string, data: string): Promise<void> {
    const temporary = `${path}.tmp-${randomBytes(8).toString('hex')}`;

    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, path);
}

async function readJson<T>(path: string, fallback: () => T): Promise<T> {
    try {
        return JSON.parse(await readFile(path, 'utf8'), BufferJSON.reviver) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return fallback();
        }

        throw error;
    }
}

/**
 * TEST ONLY, not a production provider: a folder (0700) holding `creds.json`
 * and `keys.json` (0600, written through a temporary file and a rename),
 * every write serialized, and an exclusive `lock` folder (a second acquire
 * of the same folder rejects until release). It exists to exercise restarts
 * against real files; a live deployment needs a maintained provider with
 * equivalent guarantees.
 */
export function createFileAuthProvider(folder: string): IWhatsAppAuthProvider {
    return {
        async acquire() {
            await mkdir(folder, { recursive: true, mode: 0o700 });
            await chmod(folder, 0o700);

            const lock = join(folder, 'lock');

            try {
                await mkdir(lock);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                    throw new Error('The WhatsApp auth folder is in use by another connector.', { cause: error });
                }

                throw error;
            }

            const credsPath = join(folder, 'creds.json');
            const keysPath = join(folder, 'keys.json');
            const creds = await readJson<AuthenticationCreds>(credsPath, initAuthCreds);
            const values = await readJson<Record<string, unknown>>(keysPath, () => ({}));
            let queue: Promise<void> = Promise.resolve();

            // one write at a time, in call order; a failed write fails its caller only
            const serialize = (write: () => Promise<void>): Promise<void> => {
                const next = queue.then(write);

                queue = next.catch(() => undefined);

                return next;
            };

            const persistKeys = () => writeAtomic(keysPath, JSON.stringify(values, BufferJSON.replacer));

            return {
                auth: {
                    creds,
                    keys: {
                        get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
                            const found: { [id: string]: SignalDataTypeMap[T] } = {};

                            for (const id of ids) {
                                const value = values[`${type}/${id}`];

                                if (value !== undefined) {
                                    found[id] = value as SignalDataTypeMap[T];
                                }
                            }

                            return found;
                        },
                        set(data: SignalDataSet) {
                            return serialize(async () => {
                                for (const [type, entries] of Object.entries(data)) {
                                    for (const [id, value] of Object.entries(entries ?? {})) {
                                        if (value === null) {
                                            delete values[`${type}/${id}`];
                                        } else {
                                            values[`${type}/${id}`] = value;
                                        }
                                    }
                                }

                                await persistKeys();
                            });
                        },
                    },
                },
                saveCreds: () => serialize(() => writeAtomic(credsPath, JSON.stringify(creds, BufferJSON.replacer))),
                flush: () => serialize(async () => undefined),
                release: async () => {
                    await queue;
                    await rm(lock, { recursive: true, force: true });
                },
            };
        },
    };
}
