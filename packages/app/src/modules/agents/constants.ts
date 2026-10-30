/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The lifecycle hook that starts and stops the agents dir's watcher. */
export const AGENTS_WATCHER_HOOK_NAME = 'chamvi:agents-watcher';

/** The agents dir without `CHAMVI_AGENTS_DIR`, used when it is a directory of the cwd. */
export const DEFAULT_AGENTS_DIR = 'agents';

/** Logged (warn) when the app starts without any agent: none in createApp and no agents dir. */
export const NO_AGENTS_MESSAGE = `the app has no agents: pass them to createApp or add agent folders to ./${DEFAULT_AGENTS_DIR} (or CHAMVI_AGENTS_DIR)`;

export const NO_DIRECTORY_MESSAGE = 'CHAMVI_AGENTS_DIR must name a directory.';

/** How often the boot loads a folder that changes while it is read before it leaves it to the watcher. */
export const BOOT_LOAD_ATTEMPTS = 3;

/** Maximum delay between failed skill preparations, unless the configured poll interval is longer. */
export const SKILL_PREPARATION_RETRY_MAX_MS = 60_000;

/** Logged once when the agents dir has no entry at all (an unmounted volume's mount point). */
export const EMPTY_ROOT_MESSAGE = 'the agents dir is empty; no agent is removed';

/** Logged (info) once per sweep when a folder change cancelled the agent's unsettled runs. */
export const AGENT_RELOADED_MESSAGE = 'agent reloaded';

/** Logged (info) once per sweep when a removal cancelled the agent's unsettled runs. */
export const AGENT_REMOVED_MESSAGE = 'agent removed';

/** How many characters of a folder hash a log line or a message names. */
export const HASH_PREFIX_LENGTH = 12;

/** Appended to a job-role revision conflict. */
export const JOB_CONFLICT_HINT = 'A job never reloads an agent: start the app to apply the change.';
