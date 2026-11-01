/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The lease of the store lock `knowledge:<collection>`; renewed once half of it passed. */
export const KNOWLEDGE_LOCK_TTL_MS = 300_000;

/** The first wait after a failed index (and a lock held elsewhere), doubling per failure. */
export const KNOWLEDGE_RETRY_MS = 5_000;

/** The longest wait between two attempts. */
export const KNOWLEDGE_RETRY_MAX_MS = 300_000;

/**
 * The longest an indexing `embedMany` call may take before it is given up
 * (a failure, retried on the backoff); well below KNOWLEDGE_LOCK_TTL_MS.
 */
export const KNOWLEDGE_EMBED_TIMEOUT_MS = 60_000;

/** The code of an embedding call the indexer gave up (KNOWLEDGE_EMBED_TIMEOUT_MS). */
export const KNOWLEDGE_REQUEST_ERROR_CODE = 'knowledge_request';

/** Chunks embedded per `embedMany` call. */
export const EMBED_BATCH_SIZE = 64;
