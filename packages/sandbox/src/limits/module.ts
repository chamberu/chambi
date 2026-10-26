/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import { DEFAULT_LIMITS } from '../provider/constants.ts';
import type { SandboxLimits } from '../provider/types.ts';
import {
    CPU_PATTERN,
    ENV_KEY_PATTERN,
    LIFETIME_MIN_MS,
    MEMORY_PATTERN,
    MEMORY_UNITS,
} from './constants.ts';
import { assertPositiveQuantity } from './helpers.ts';

/** Cores of a Kubernetes CPU quantity: `'1'` -> 1, `'500m'` -> 0.5, `'1.5'` -> 1.5. */
export function parseCpu(value: string): number {
    const match = typeof value === 'string' ? CPU_PATTERN.exec(value) : null;
    if (!match) {
        throw new InvalidAgentDefinitionError(`cpu must look like "1", "1.5" or "500m", got ${JSON.stringify(value)}.`);
    }
    const amount = Number(match[1]);
    return match[2] === 'm' ? amount / 1000 : amount;
}

/** Bytes of a Kubernetes memory quantity: `Ki`/`Mi`/`Gi`/`Ti` (1024^n), `K`/`M`/`G`/`T` (1000^n) or plain. */
export function parseMemory(value: string): number {
    const match = typeof value === 'string' ? MEMORY_PATTERN.exec(value) : null;
    if (!match) {
        throw new InvalidAgentDefinitionError(`memory and storage must look like "2Gi", "512M" or "1024", got ${JSON.stringify(value)}.`);
    }
    const amount = Number(match[1]);
    return match[2] ? amount * (MEMORY_UNITS[match[2]] as number) : amount;
}

/**
 * Merges limit layers over `DEFAULT_LIMITS`, later layers winning (an
 * `undefined` value keeps the earlier one). Every given value is checked:
 * cpu, memory and storage parse to more than zero, pids is an integer of at
 * least 1, maxLifetimeMs an integer of at least 1_000 (exec timeouts are
 * capped separately). InvalidAgentDefinitionError otherwise.
 */
export function resolveLimits(...layers: Array<SandboxLimits | undefined>): Required<SandboxLimits> {
    const limits: Required<SandboxLimits> = { ...DEFAULT_LIMITS };
    for (const layer of layers) {
        if (layer === undefined) continue;
        if (!isObject(layer)) {
            throw new InvalidAgentDefinitionError('limits must be an object.');
        }
        if (layer.cpu !== undefined) {
            assertPositiveQuantity('cpu', layer.cpu, parseCpu);
            limits.cpu = layer.cpu;
        }
        if (layer.memory !== undefined) {
            assertPositiveQuantity('memory', layer.memory, parseMemory);
            limits.memory = layer.memory;
        }
        if (layer.storage !== undefined) {
            assertPositiveQuantity('storage', layer.storage, parseMemory);
            limits.storage = layer.storage;
        }
        if (layer.pids !== undefined) {
            if (!Number.isSafeInteger(layer.pids) || layer.pids < 1) {
                throw new InvalidAgentDefinitionError(`limits.pids must be an integer of at least 1, got ${JSON.stringify(layer.pids)}.`);
            }
            limits.pids = layer.pids;
        }
        if (layer.maxLifetimeMs !== undefined) {
            if (!Number.isSafeInteger(layer.maxLifetimeMs) || layer.maxLifetimeMs < LIFETIME_MIN_MS) {
                throw new InvalidAgentDefinitionError(`limits.maxLifetimeMs must be an integer of at least ${LIFETIME_MIN_MS}, got ${JSON.stringify(layer.maxLifetimeMs)}.`);
            }
            limits.maxLifetimeMs = layer.maxLifetimeMs;
        }
    }
    return limits;
}

/** Keys like `^[A-Za-z_][A-Za-z0-9_]*$`, string values without NUL; InvalidAgentDefinitionError otherwise. */
export function assertSandboxEnv(env: Record<string, string> | undefined): void {
    if (env === undefined) return;
    if (!isObject(env)) {
        throw new InvalidAgentDefinitionError('env must be an object of strings.');
    }
    for (const [key, value] of Object.entries(env)) {
        if (!ENV_KEY_PATTERN.test(key)) {
            throw new InvalidAgentDefinitionError(`env key ${JSON.stringify(key)} must match ${ENV_KEY_PATTERN.source}.`);
        }
        if (typeof value !== 'string' || value.includes('\0')) {
            throw new InvalidAgentDefinitionError(`env ${key} must be a string without NUL.`);
        }
    }
}
