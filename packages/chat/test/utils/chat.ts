/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import type {
    Lock,
    Logger,
    QueueEntry,
    StateAdapter,
} from 'chat';

export type RecordingState = StateAdapter & {
    /** every key setIfNotExists was asked for, in call order */
    readonly claimed: string[];
};

/**
 * An in-memory Chat SDK StateAdapter (the SDK ships none in its main package),
 * recording the keys of setIfNotExists, the SDK's pre-handler dedupe.
 */
export function createMemoryState(): RecordingState {
    const values = new Map<string, unknown>();
    const lists = new Map<string, unknown[]>();
    const queues = new Map<string, QueueEntry[]>();
    const subscriptions = new Set<string>();
    const locks = new Map<string, Lock>();
    const claimed: string[] = [];

    return {
        claimed,
        async acquireLock(threadId, ttlMs) {
            if (locks.has(threadId)) {
                return null;
            }

            const lock = {
                threadId, 
                token: `${threadId}:${locks.size}`, 
                expiresAt: Date.now() + ttlMs, 
            };

            locks.set(threadId, lock);

            return lock;
        },
        async appendToList(key, value, options) {
            const list = [...(lists.get(key) ?? []), value];

            lists.set(key, options?.maxLength ? list.slice(-options.maxLength) : list);
        },
        connect: () => Promise.resolve(),
        async delete(key) {
            values.delete(key);
        },
        async dequeue(threadId) {
            return queues.get(threadId)?.shift() ?? null;
        },
        disconnect: () => Promise.resolve(),
        async enqueue(threadId, entry) {
            const queue = queues.get(threadId) ?? [];

            queue.push(entry);
            queues.set(threadId, queue);

            return queue.length;
        },
        async extendLock(lock) {
            return locks.get(lock.threadId)?.token === lock.token;
        },
        async forceReleaseLock(threadId) {
            locks.delete(threadId);
        },
        async get<T>(key: string) {
            return (values.get(key) as T | undefined) ?? null;
        },
        async getList<T>(key: string) {
            return (lists.get(key) ?? []) as T[];
        },
        async isSubscribed(threadId) {
            return subscriptions.has(threadId);
        },
        async queueDepth(threadId) {
            return queues.get(threadId)?.length ?? 0;
        },
        async releaseLock(lock) {
            if (locks.get(lock.threadId)?.token === lock.token) {
                locks.delete(lock.threadId);
            }
        },
        async set(key, value) {
            values.set(key, value);
        },
        async setIfNotExists(key, value) {
            claimed.push(key);

            if (values.has(key)) {
                return false;
            }

            values.set(key, value);

            return true;
        },
        async subscribe(threadId) {
            subscriptions.add(threadId);
        },
        async unsubscribe(threadId) {
            subscriptions.delete(threadId);
        },
    };
}

export type LogRecord = {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    args: unknown[];
};

export type RecordingLogger = Logger & { readonly records: LogRecord[] };

/** A Chat SDK Logger that records instead of printing; children share the records. */
export function createRecordingLogger(records: LogRecord[] = []): RecordingLogger {
    const log = (level: LogRecord['level']) => (message: string, ...args: unknown[]) => {
        records.push({
            level, 
            message, 
            args, 
        });
    };

    return {
        records,
        child: () => createRecordingLogger(records),
        debug: log('debug'),
        info: log('info'),
        warn: log('warn'),
        error: log('error'),
    };
}
