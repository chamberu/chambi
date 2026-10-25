/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ValueTransformer } from 'typeorm';
import { toJsonParameter } from './helpers.ts';

export const TableName = {
    RUNS: 'runs',
    STEPS: 'steps',
    CHECKPOINTS: 'checkpoints',
    IDEMPOTENCY_KEYS: 'idempotency_keys',
    LOCKS: 'locks',
    EFFECTS: 'effects',
    KV: 'kv',
    DOCS: 'docs',
    ARTIFACTS: 'artifacts',
    AGENT_REVISIONS: 'agent_revisions',
} as const;

/**
 * jsonb column whose null is a value: null is stored as JSON null,
 * undefined as SQL NULL.
 */
export const JSON_VALUE_TRANSFORMER: ValueTransformer = {
    to: (value: unknown) => (value === undefined ? undefined : toJsonParameter(value)),
    from: (value: unknown) => value,
};

/**
 * jsonb column for an optional property: null and undefined are stored as
 * SQL NULL (the property is absent).
 */
export const OPTIONAL_JSON_TRANSFORMER: ValueTransformer = {
    to: (value: unknown) => (value === undefined || value === null ? null : toJsonParameter(value)),
    from: (value: unknown) => value,
};
