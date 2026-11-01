/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { DisconnectReason } from 'baileys';
import type {
    BaileysEventMap,
    SignalDataSet,
    SignalDataTypeMap,
    SignalKeyStore,
} from 'baileys';
import { ChamviError, InvalidRunStateError } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { isObject } from 'smob';
import {
    WHATSAPP_AUTH_ERROR_CODE,
    WHATSAPP_CONNECTION_ERROR_CODE,
    WHATSAPP_LOGGED_OUT_ERROR_CODE,
    WHATSAPP_RECONNECT,
    WHATSAPP_SHUTDOWN_TIMEOUT_MS,
} from './constants.ts';
import type {
    WhatsAppAuthLease,
    WhatsAppConnection,
    WhatsAppConnectionOptions,
    WhatsAppConnectionStatus,
    WhatsAppSocket,
} from './types.ts';

/**
 * One acquisition of the lease: every auth callback of its sockets is
 * admitted only while it is in use, so nothing writes under an ended one.
 */
type Generation = {
    readonly clock: IClock;
    readonly signal: AbortSignal;
    /** auth calls are admitted (reads and writes) */
    admitting: boolean;
    /** close began: no socket, no reconnect from here on */
    closed: boolean;
    readonly writes: Set<Promise<unknown>>;
    lease?: WhatsAppAuthLease;
    /** settles once acquire settled and a late lease was released */
    acquiring?: Promise<void>;
    socket?: WhatsAppSocket;
    detach?: () => void;
    timer?: { clear(): void };
    /** failed reconnect attempts in a row */
    failures: number;
    closing?: Promise<void>;
};

/** Drops everything: Baileys' own log lines would otherwise carry pairing material and session details. */
const SILENT_LOGGER = {
    level: 'silent',
    child: () => SILENT_LOGGER,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

function failure(code: string, message: string, cause?: unknown): ChamviError {
    return new ChamviError({
        code,
        message,
        ...(cause !== undefined ? { cause } : {}),
    });
}

/** The status code of a close (a Boom's `output.statusCode`), if any. */
function statusCodeOf(error: unknown): number | undefined {
    if (isObject(error) && isObject(error.output) && typeof error.output.statusCode === 'number') {
        return error.output.statusCode;
    }

    return undefined;
}

/** The wait before reconnect attempt `n` (0-based), see WHATSAPP_RECONNECT. */
function backoff(n: number): number {
    const base = Math.min(WHATSAPP_RECONNECT.maxMs, WHATSAPP_RECONNECT.initialMs * WHATSAPP_RECONNECT.factor ** n);
    const scaled = base * (1 + WHATSAPP_RECONNECT.jitter * (2 * Math.random() - 1));

    return Math.max(1, Math.min(WHATSAPP_RECONNECT.maxMs, Math.round(scaled)));
}

/** `promise`, or the signal's reason once it aborts first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);

        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
}

/** Whether `work` settled within `ms` on the clock; its rejection rethrown. */
async function within(clock: IClock, ms: number, work: Promise<void>): Promise<boolean> {
    let timer: { clear(): void } | undefined;
    const timeout = new Promise<false>((resolve) => {
        timer = clock.setTimeout(() => resolve(false), ms);
    });

    try {
        return await Promise.race([work.then(() => true as const), timeout]);
    } finally {
        timer?.clear();
    }
}

/**
 * Runs an auth call of the generation, tracked until it settles; refused
 * (InvalidRunStateError) once the generation stopped admitting.
 */
function admit<T>(generation: Generation, call: () => T | Promise<T>): Promise<T> {
    if (!generation.admitting) {
        return Promise.reject(new InvalidRunStateError('The WhatsApp auth lease of this connection has ended; the auth call is refused.'));
    }

    let task: Promise<T>;

    try {
        task = Promise.resolve(call());
    } catch (error) {
        task = Promise.reject(error);
    }

    generation.writes.add(task);

    const forget = () => generation.writes.delete(task);

    task.then(forget, forget);

    return task;
}

/** The lease's key store behind the generation guard: Baileys gets this one only. */
function guardKeys(generation: Generation, keys: SignalKeyStore): SignalKeyStore {
    return {
        get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => admit(generation, () => keys.get(type, ids)),
        set: (data: SignalDataSet) => admit(generation, () => keys.set(data)),
        ...(keys.clear ? { clear: () => admit(generation, () => keys.clear!()) } : {}),
    };
}

/**
 * The WhatsApp connection: `connect` acquires the lease (the provider's
 * exclusivity), then builds a socket over it; Baileys' connection events
 * alone set the status. An unexpected close reconnects with backoff on the
 * clock; a logout or a replacing session does not. `close` (idempotent per
 * connect) ends the socket and the reconnect, stops admitting auth calls,
 * waits for the pending ones and the lease's flush (the socket's end
 * included, at most WHATSAPP_SHUTDOWN_TIMEOUT_MS), then releases the lease. Past that bound,
 * or when the flush failed, the lease is not released: it stays fenced (the
 * guard refuses every later call) and the failure is reported.
 */
export function createWhatsAppConnection(options: WhatsAppConnectionOptions): WhatsAppConnection {
    let current: Generation | undefined;
    let status: WhatsAppConnectionStatus = 'stopped';

    const report = (error: unknown) => {
        try {
            options.onError(error);
        } catch {
            // a throwing onError must not break the connection's bookkeeping
        }
    };

    const isCurrent = (generation: Generation, socket?: WhatsAppSocket) => current === generation &&
        !generation.closed &&
        (socket === undefined || generation.socket === socket);

    const setStatus = (generation: Generation, next: WhatsAppConnectionStatus) => {
        if (current === generation) {
            status = next;
        }
    };

    const release = async (lease: WhatsAppAuthLease) => {
        try {
            await lease.release();
        } catch (error) {
            report(failure(WHATSAPP_AUTH_ERROR_CODE, 'Releasing the WhatsApp auth lease failed.', error));
        }
    };

    let scheduleReconnect: (generation: Generation) => void = () => undefined;

    const dropSocket = (generation: Generation) => {
        generation.detach?.();
        delete generation.detach;
        delete generation.socket;
    };

    const onClose = (generation: Generation, code: number | undefined) => {
        dropSocket(generation);

        if (code === DisconnectReason.loggedOut) {
            setStatus(generation, 'logged-out');
            report(failure(WHATSAPP_LOGGED_OUT_ERROR_CODE, 'WhatsApp logged this device out: pair the account again; nothing reconnects.'));

            return;
        }

        setStatus(generation, 'disconnected');

        if (code === DisconnectReason.connectionReplaced) {
            report(failure(WHATSAPP_CONNECTION_ERROR_CODE, 'Another client replaced this WhatsApp session; nothing reconnects (one connector per account).'));

            return;
        }

        scheduleReconnect(generation);
    };

    const createSocket = (generation: Generation) => {
        const lease = generation.lease!;
        const socket = options.socketFactory({
            ...options.socketOptions,
            auth: {
                creds: lease.auth.creds,
                keys: guardKeys(generation, lease.auth.keys),
            },
            logger: SILENT_LOGGER,
        });

        const onUpdate = (update: BaileysEventMap['connection.update']) => {
            if (!isCurrent(generation, socket)) {
                return;
            }

            if (typeof update.qr === 'string' && update.qr.length > 0) {
                try {
                    options.onPairing({ qr: update.qr });
                } catch {
                    // its error could carry the material: reported without it
                    report(failure(WHATSAPP_CONNECTION_ERROR_CODE, 'onPairing threw; the pairing material was not handed on.'));
                }
            }

            if (update.connection === 'open') {
                generation.failures = 0;
                setStatus(generation, 'connected');
            } else if (update.connection === 'connecting') {
                setStatus(generation, 'connecting');
            } else if (update.connection === 'close') {
                onClose(generation, statusCodeOf(update.lastDisconnect?.error));
            }
        };

        const onCreds = () => {
            if (!generation.admitting) {
                return;
            }

            admit(generation, () => lease.saveCreds()).catch((error: unknown) => {
                report(failure(WHATSAPP_AUTH_ERROR_CODE, 'Saving the WhatsApp creds failed.', error));
            });
        };

        const onMessages = (upsert: BaileysEventMap['messages.upsert']) => {
            if (isCurrent(generation, socket)) {
                options.onMessages(socket, upsert);
            }
        };

        socket.ev.on('connection.update', onUpdate);
        socket.ev.on('creds.update', onCreds);
        socket.ev.on('messages.upsert', onMessages);
        generation.socket = socket;
        generation.detach = () => {
            socket.ev.off('connection.update', onUpdate);
            socket.ev.off('creds.update', onCreds);
            socket.ev.off('messages.upsert', onMessages);
        };
    };

    scheduleReconnect = (generation: Generation) => {
        if (generation.failures >= WHATSAPP_RECONNECT.maxAttempts) {
            report(failure(WHATSAPP_CONNECTION_ERROR_CODE, `WhatsApp did not reconnect after ${WHATSAPP_RECONNECT.maxAttempts} attempts; restart the channel to try again.`));

            return;
        }

        const delay = backoff(generation.failures);

        generation.failures += 1;
        generation.timer = generation.clock.setTimeout(() => {
            delete generation.timer;

            if (!isCurrent(generation)) {
                return;
            }

            setStatus(generation, 'connecting');

            try {
                createSocket(generation);
            } catch (error) {
                report(failure(WHATSAPP_CONNECTION_ERROR_CODE, 'Creating the WhatsApp socket failed.', error));
                setStatus(generation, 'disconnected');
                scheduleReconnect(generation);
            }
        }, delay);
    };

    const closeGeneration = async (generation: Generation): Promise<void> => {
        generation.closed = true;
        generation.admitting = false;
        generation.timer?.clear();
        delete generation.timer;
        setStatus(generation, 'stopped');

        const { socket } = generation;

        dropSocket(generation);

        if (socket) {
            const ending = (async () => {
                await socket.end(undefined);
            })();

            try {
                if (!await within(generation.clock, WHATSAPP_SHUTDOWN_TIMEOUT_MS, ending)) {
                    ending.catch(() => undefined);
                    report(failure(WHATSAPP_CONNECTION_ERROR_CODE, `Ending the WhatsApp socket did not finish within ${WHATSAPP_SHUTDOWN_TIMEOUT_MS}ms.`));
                }
            } catch (error) {
                report(failure(WHATSAPP_CONNECTION_ERROR_CODE, 'Ending the WhatsApp socket failed.', error));
            }
        }

        // a write admitted before the close finishes, then the lease flushes it; admission closed above,
        // so this phase gets its own bound: a dead link's end() never eats into it
        const settling = (async () => {
            await generation.acquiring;
            await Promise.allSettled([...generation.writes]);
            await generation.lease?.flush();
        })();

        let settled: boolean;

        try {
            settled = await within(generation.clock, WHATSAPP_SHUTDOWN_TIMEOUT_MS, settling);
        } catch (error) {
            report(failure(WHATSAPP_AUTH_ERROR_CODE, 'Flushing the WhatsApp auth lease failed; it stays held (not released).', error));

            return;
        }

        if (!settled) {
            settling.catch(() => undefined);
            report(failure(
                WHATSAPP_AUTH_ERROR_CODE,
                `The WhatsApp auth writes did not finish within ${WHATSAPP_SHUTDOWN_TIMEOUT_MS}ms; the lease stays held (not released).`,
            ));

            return;
        }

        if (generation.lease) {
            await release(generation.lease);
        }
    };

    const connect = async ({ signal, clock }: { signal: AbortSignal; clock: IClock }): Promise<void> => {
        if (current && !current.closed) {
            throw new InvalidRunStateError('The WhatsApp connection is already connected.');
        }

        // a close still settling (flush, release) finishes before the next lease is taken
        await current?.closing;
        // an aborted connect never becomes the current generation
        signal.throwIfAborted();

        const generation: Generation = {
            clock: options.clock ?? clock,
            signal,
            admitting: true,
            closed: false,
            writes: new Set(),
            failures: 0,
        };

        current = generation;
        status = 'connecting';

        const acquired = (async () => {
            const lease = await options.auth.acquire(signal);

            // a lease that arrives after the stop is given back at once, never used
            if (generation.closed || signal.aborted) {
                await release(lease);

                return undefined;
            }

            generation.lease = lease;

            return lease;
        })();

        generation.acquiring = acquired.then(() => undefined, () => undefined);

        let lease: WhatsAppAuthLease | undefined;

        try {
            lease = await untilAborted(acquired, signal);
        } catch (error) {
            setStatus(generation, 'stopped');

            throw error;
        }

        // an abort or close between the lease's arrival and here builds no socket (the close releases the lease)
        if (!lease || signal.aborted || generation.closed) {
            setStatus(generation, 'stopped');

            throw signal.aborted ? signal.reason : new InvalidRunStateError('The WhatsApp connection closed while it connected.');
        }

        createSocket(generation);
    };

    return {
        status: () => status,
        socket: () => (current && !current.closed && status === 'connected' ? current.socket : undefined),
        connect,
        close() {
            const generation = current;

            if (!generation) {
                return Promise.resolve();
            }

            generation.closing ??= closeGeneration(generation);

            return generation.closing;
        },
    };
}
