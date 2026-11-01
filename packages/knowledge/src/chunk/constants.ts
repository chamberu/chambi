/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Names the chunking rules; a change re-embeds every collection (a new generation). */
export const CHUNKER_VERSION = 'text-v1';

/** A chunk's maximum length in UTF-16 code units. */
export const CHUNK_MAX_CHARS = 2000;

/** How far a chunk reaches back into the one before it. */
export const CHUNK_OVERLAP_CHARS = 200;
