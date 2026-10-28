/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const SKILL_CONTROL_PATTERN = /\p{Cc}/u;
export const SKILL_MAX_FRONTMATTER_BYTES = 4 * 1024;
export const SKILL_MAX_BODY_BYTES = 64 * 1024;
export const SKILL_MAX_REFERENCE_BYTES = 128 * 1024;
export const SKILL_MAX_TOTAL_BYTES = 1024 * 1024;
export const SKILL_MAX_FILES = 64;
export const SKILL_MAX_BUNDLES = 16;
export const SKILL_MAX_INVENTORY_ENTRIES = 1024;
export const SKILL_MAX_DIRECTORY_DEPTH = 64;
export const SKILL_HASH_HEADER = 'chamvi-skill-bundle-v1\n';
