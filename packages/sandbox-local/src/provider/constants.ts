/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export const LOCAL_PROVIDER_NAME = 'local';

/** Folder under `os.tmpdir()` when no `root` is given. */
export const DEFAULT_ROOT_NAME = 'chamvi-workspaces';

/** `{ runId, expiresAt }` of a workspace, read by the garbage collection. */
export const WORKSPACE_RECORD = 'workspace.json';

/** The package cache every workspace of a root shares, `<root>/.cache` (no workspace id, so never collected). */
export const CACHE_DIR_NAME = '.cache';

/** The workspace root (`/workspace` for the model) inside a workspace folder. */
export const REPO_DIR = 'repo';

/**
 * After a kill or the command's own exit, how long the output pipes may stay
 * open (held by a process that left the group, or a background job the
 * command started) before they are closed and the exec settles.
 */
export const KILL_GRACE_MS = 2_000;

/**
 * How often a workspace checks that the process groups of its background
 * jobs still exist, and forgets the ended ones: a group id is only reused
 * once every member of the group is gone, so the dispose never kills a
 * group that is no longer the command's.
 */
export const LINGER_CHECK_MS = 1_000;

/** PATH when the host has none. */
export const FALLBACK_PATH = '/usr/local/bin:/usr/bin:/bin';

export const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
