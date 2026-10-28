/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ValueTransformer } from 'typeorm';
import { toJsonParameter } from './helpers.ts';

export const TableName = {
    CONVERSATIONS: 'chamvi_conversations',
    CONVERSATION_TURNS: 'chamvi_conversation_turns',
    CONVERSATION_ITEMS: 'chamvi_conversation_items',
    CONVERSATION_NOTES: 'chamvi_conversation_notes',
    CONVERSATION_OPERATIONS: 'chamvi_conversation_operations',
    RUNS: 'chamvi_runs',
    STEPS: 'chamvi_steps',
    CHECKPOINTS: 'chamvi_checkpoints',
    IDEMPOTENCY_KEYS: 'chamvi_idempotency_keys',
    LOCKS: 'chamvi_locks',
    EFFECTS: 'chamvi_effects',
    KV: 'chamvi_kv',
    DOCS: 'chamvi_docs',
    ARTIFACTS: 'chamvi_artifacts',
    AGENT_REVISIONS: 'chamvi_agent_revisions',
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
