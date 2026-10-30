/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { systemClock } from '@chamvi/core';
import type { LogLevel } from '../config/types.ts';
import { LOG_LEVEL_RANK } from './constants.ts';
import { serializeError, toLine } from './helpers.ts';
import type { ILogger, LoggerOptions } from './types.ts';

function writeStderr(line: string): void {
    process.stderr.write(`${line}\n`);
}

/**
 * A JSON line logger: `{ level, time, msg, ...fields, error? }` per entry.
 * It never throws, also not when `write` does.
 */
export function createLogger(options: LoggerOptions = {}): ILogger {
    const rank = LOG_LEVEL_RANK[options.level ?? 'info'];
    const clock = options.clock ?? systemClock;
    const write = options.write ?? writeStderr;

    const log = (level: LogLevel, msg: string, fields: Record<string, unknown> | undefined, error?: { value: unknown }) => {
        if (LOG_LEVEL_RANK[level] > rank) {
            return;
        }

        try {
            const head = {
                level,
                time: clock.now().toISOString(),
                msg,
            };

            write(toLine(head, fields ?? {}, error ? serializeError(error.value) : undefined));
        } catch {
            // a closed stream or a throwing clock must never break the caller
        }
    };

    return {
        error(message, error, fields) {
            log('error', message, fields, typeof error === 'undefined' ? undefined : { value: error });
        },
        warn(message, fields) {
            log('warn', message, fields);
        },
        info(message, fields) {
            log('info', message, fields);
        },
        debug(message, fields) {
            log('debug', message, fields);
        },
    };
}
