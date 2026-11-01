/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import { SandboxError, ValidationError, systemClock } from '@chamvi/core';
import { createOutputCollector } from '../output/module.ts';
import { abortedCreate } from '../provider/module.ts';
import type { IExecTransport } from '../remote/types.ts';
import {
    CACHE_FOLDERS,
    IMAGE_PATTERN,
    IMAGE_PROBE_MISSING_EXIT,
    IMAGE_PROBE_SCRIPT,
    IMAGE_PROBE_TIMEOUT_MS,
} from './constants.ts';

/** How the probe's missing names read in the error. */
const MISSING_LABELS: Readonly<Record<string, string>> = {
    git: 'git',
    timeout: 'timeout',
    'timeout-k': 'a timeout that supports -k (GNU coreutils)',
    '/bin/sh': 'sh at /bin/sh',
    head: 'head in /usr/bin or /bin',
    base64: 'base64 in /usr/bin or /bin',
    tr: 'tr in /usr/bin or /bin',
};

/** Probe output is a few words: never hold more. */
const PROBE_OUTPUT_MAX_BYTES = 1_024;

/**
 * An image reference (`IMAGE_PATTERN`: registry, path, tag and digest
 * characters, at most 255); returns it. ValidationError otherwise, never
 * echoing the value.
 */
export function assertImage(value: unknown): string {
    if (typeof value !== 'string' || !IMAGE_PATTERN.test(value)) {
        throw new ValidationError('image must be an image reference like "node:24" or "ghcr.io/owner/name:tag" ' +
            '(letters, digits and . _ - / : @ +, starting with a letter or digit, at most 255 characters).');
    }

    return value;
}

/** The package-cache variables (`CACHE_ENV`'s keys) pointing into folders under `dir`. */
export function cacheEnv(dir: string): Record<string, string> {
    return Object.fromEntries(Object.entries(CACHE_FOLDERS).map(([key, folder]) => [key, `${dir}/${folder}`]));
}

/** True for uid 0 or `root`, with or without a group (`'0:1000'`, `'root:root'`). */
export function isRootUser(user: string | number): boolean {
    if (typeof user === 'number') {
        return user === 0;
    }

    const name = user.split(':')[0];

    return name === '0' || name === 'root';
}

/**
 * Checks once, right after the container or pod started and before any
 * checkout, that the image has `sh` (also at `/bin/sh`), `git`, a `timeout`
 * that takes `-k` and `head`, `base64` and `tr` in `/usr/bin` or `/bin`
 * (`IMAGE_PROBE_SCRIPT`, run straight on the transport, since every
 * workspace exec goes through `timeout`). SandboxError naming what is
 * missing, or why the probe failed (also after `IMAGE_PROBE_TIMEOUT_MS`
 * on the clock); `abortedCreate()` once `signal` fires.
 */
export async function probeImage(
    transport: IExecTransport,
    options: {
        image: string;
        clock?: IClock;
        signal?: AbortSignal
    },
): Promise<void> {
    const { image, signal } = options;
    const clock = options.clock ?? systemClock;

    if (signal?.aborted) {
        throw abortedCreate();
    }

    const controller = new AbortController();
    const stdout = createOutputCollector(PROBE_OUTPUT_MAX_BYTES);
    const stderr = createOutputCollector(PROBE_OUTPUT_MAX_BYTES);
    let timedOut = false;
    const timer = clock.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_PROBE_TIMEOUT_MS);
    const onAbort = () => controller.abort();

    signal?.addEventListener('abort', onAbort, { once: true });

    let exitCode: number;

    try {
        ({ exitCode } = await new Promise<{ exitCode: number }>((resolve, reject) => {
            // the transport may not watch its signal: settle on the abort anyway
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
            Promise.try(() => transport.exec(['sh', '-c', IMAGE_PROBE_SCRIPT], {
                stdout,
                stderr,
                signal: controller.signal,
            }))
                .then(resolve, reject);
        }));
    } catch (error) {
        if (signal?.aborted) {
            throw abortedCreate(error);
        }

        if (timedOut) {
            throw new SandboxError(`cannot probe image ${image}: no answer within ${IMAGE_PROBE_TIMEOUT_MS} ms.`);
        }

        const message = Error.isError(error) ? error.message : String(error);
        throw new SandboxError(`cannot probe image ${image}: ${message}`, { cause: error });
    } finally {
        timer.clear();
        signal?.removeEventListener('abort', onAbort);
    }

    if (exitCode === 0) {
        return;
    }

    const missing = stdout.text().split(/\s+/).filter((name) => Object.hasOwn(MISSING_LABELS, name));

    // a shell that cannot start is exit 127 (126: not executable) without output
    if (missing.length === 0 && (exitCode === 127 || exitCode === 126)) {
        missing.push('sh');
    }

    if (missing.length === 0 || (exitCode !== IMAGE_PROBE_MISSING_EXIT && !missing.includes('sh'))) {
        throw new SandboxError(`cannot probe image ${image}: the probe exited with ${exitCode}.`);
    }

    const labels = missing.map((name) => MISSING_LABELS[name] ?? name);
    throw new SandboxError(`image ${image} lacks what a workspace needs: ${labels.join(', ')}. ` +
        'Pick an image with sh, git and coreutils, or install them in it.');
}
