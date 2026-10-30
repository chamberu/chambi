/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The purge timer's lifecycle hook. */
export const PURGE_HOOK_NAME = 'chamvi:purge';

export const MEMORY_STORE_WARNING = 'DATABASE_URL unset: the memory store keeps runs in memory; restarts lose them and replicas share nothing.';

/** How a check's store_not_migrated error ends, after the pending count. */
export const STORE_NOT_MIGRATED_HINT = 'run chamvi migrate or set CHAMVI_MIGRATE=true.';

/** What a URL's `:<password>@` pair becomes in an error. */
export const MASKED_PAIR = ':***@';

/**
 * How long the TypeORM data source built from a URL waits for Postgres to
 * accept the first connection (pg has no timeout of its own), so a stop
 * during an unanswered connect ends well inside CHAMVI_FORCE_EXIT_MS.
 */
export const STORE_CONNECT_TIMEOUT_MS = 10_000;

export const MEMORY_CONVERSATION_WARNING = 'Conversation memory is process-local: restarts lose history and notes; replicas share nothing. Use PostgreSQL for durability.';
