/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { PATH_GUARD_SCRIPT } from '../image/constants.ts';

/** Seconds GNU `timeout -k` waits after TERM before it sends KILL. */
export const TIMEOUT_KILL_AFTER_SECONDS = 5;

/**
 * How long past its timeout an exec may take before the workspace stops
 * waiting on the transport and reports exit 137.
 */
export const EXEC_GRACE_MS = 15_000;

/**
 * How long a command's output may stay open after it exited (held by a
 * background job it started) before the exec returns with its exit code,
 * like the Docker daemon's own wait for the streams.
 */
export const EXIT_DRAIN_MS = 2_000;

/** What the exec script reports instead of an exit status when the working directory is missing. */
export const EXIT_MARKER_CWD = 'cwd';

/**
 * Runs `$3...` in the directory `$2` and reports how it ended on stderr as
 * the marker `$1` followed by the exit status (or `EXIT_MARKER_CWD` for a
 * directory it cannot enter) and a newline. The marker tells the workspace
 * that the command exited, although a background job may hold its output.
 * `PATH_GUARD_SCRIPT` runs first, so neither the `timeout` wrapper nor the
 * checkout's `git` resolve to a program in the shared cache.
 */
export const EXEC_SCRIPT = `${PATH_GUARD_SCRIPT}; ` +
    'cd -- "$2" 2>/dev/null || { printf \'%s%s\\n\' "$1" cwd >&2; exit 127; }; ' +
    'm=$1; shift 2; "$@"; s=$?; printf \'%s%s\\n\' "$m" "$s" >&2; exit "$s"';

/** How long a failed exec waits for `IExecTransport.alive` before it reads the workspace as alive. */
export const ALIVE_PROBE_TIMEOUT_MS = 5_000;

/** How much of a command's stderr a file error carries. */
export const ERROR_STDERR_MAX_LENGTH = 2_000;

/**
 * Creates the parent directories of `$1` and writes exactly `$2` bytes of
 * stdin to it (`head -c` stops after them, so no stdin EOF is needed):
 * into the temporary file `.chamvi-write-$3` next to it, carrying the old
 * file's mode (`cp -p`), then renamed over it, so a reader or a second
 * writer never sees a cut file. A symbolic link, or a directory that takes
 * no new file, is written in place.
 */
export const WRITE_FILE_SCRIPT = [
    'd=$(dirname -- "$1") && mkdir -p -- "$d" || exit',
    'if [ -d "$1" ]; then printf \'%s: Is a directory\\n\' "$1" >&2; exit 1; fi',
    'if [ -L "$1" ]; then head -c "$2" > "$1"; exit; fi',
    't="$d/.chamvi-write-$3"',
    'trap \'rm -f -- "$t"\' EXIT',
    '{ true > "$t"; } 2>/dev/null || { head -c "$2" > "$1"; exit; }',
    'if [ -e "$1" ]; then cp -p -- "$1" "$t" || exit; fi',
    'head -c "$2" > "$t" && mv -f -- "$t" "$1"',
].join('\n');
