/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The entrypoint file names, in the order each directory is read. */
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/** Bytes of one source; a larger file is omitted whole, never cut. */
export const INSTRUCTION_SOURCE_MAX_BYTES = 32_768;

/** Bytes of every source of one request together. */
export const INSTRUCTION_TOTAL_MAX_BYTES = 131_072;

/** Distinct sources of one request. */
export const INSTRUCTION_SOURCES_MAX = 32;

/** Include edges from an entrypoint to the deepest file it reaches. */
export const INSTRUCTION_INCLUDE_DEPTH_MAX = 8;

/** Requested paths of one request. */
export const INSTRUCTION_PATHS_MAX = 32;

/** Distinct directories (the root included) whose entrypoints one request reads. */
export const INSTRUCTION_DIRECTORIES_MAX = 64;

/** Inspections (requested paths, entrypoint candidates) and include references of one request. */
export const INSTRUCTION_REFERENCES_MAX = 512;

/** Diagnostics of one request, the closing `limit` entry included. */
export const INSTRUCTION_DIAGNOSTICS_MAX = 64;

/** UTF-8 bytes of the diagnostics' paths and messages together. */
export const INSTRUCTION_DIAGNOSTICS_MAX_BYTES = 8_192;

/** UTF-8 bytes of one workspace-relative path. */
export const INSTRUCTION_PATH_MAX_BYTES = 4_096;

/** Time of one request. */
export const INSTRUCTION_REQUEST_TIMEOUT_MS = 30_000;

/** Time of one exec of the discovery script. */
export const INSTRUCTION_EXEC_TIMEOUT_MS = 5_000;

/** Paths and their bytes one inspection exec takes. */
export const INSPECT_BATCH_MAX_PATHS = 256;
export const INSPECT_BATCH_MAX_BYTES = 65_536;

/** The protocol version every frame line starts with. */
export const PROTOCOL = 'chamvi-instructions/1';

/** The exit status of the script when a utility is missing (`<PROTOCOL> missing <name>` on stdout). */
export const MISSING_UTILITY_EXIT = 3;

/** The only PATH the script resolves utilities on: never the workspace or its cwd. */
export const TRUSTED_PATH = '/usr/bin:/bin';

/**
 * The discovery script, run as `/bin/sh -c <script> sh <mode> <path>...` in
 * the workspace root with the paths as data (never interpolated). It
 * executes nothing from the repository: only shell built-ins and `head`,
 * `base64` and `tr` from `TRUSTED_PATH`. Incidental stderr is dropped; fd 4
 * keeps the original stderr for the read status line.
 *
 * `walk` checks a normalized relative path component by component and sets
 * `r`: `link <k>` for a symbolic link at component k (never followed),
 * `absent`, `denied <k>` when component k cannot be looked up because its
 * parent is not searchable, else `file`, `dir` or `special` for the last
 * component. A best-effort check: a concurrent change between the check and
 * the read is not excluded.
 *
 * - `inspect <path>...`: `<PROTOCOL> inspect <n>`, one `<index> <status>`
 *   line per path, `<PROTOCOL> end`.
 * - `read <path>`: for a file `<PROTOCOL> read file`, the first
 *   `INSTRUCTION_SOURCE_MAX_BYTES + 1` bytes as one base64 line,
 *   `<PROTOCOL> end`, and `<PROTOCOL> head <status>` on stderr; for anything
 *   else `<PROTOCOL> read <status>` (or `denied` when the open fails) and
 *   `<PROTOCOL> end`.
 */
export const DISCOVERY_SCRIPT = [
    `PATH=${TRUSTED_PATH}; export PATH; unset CDPATH`,
    `V=${PROTOCOL}`,
    'exec 4>&2 2>/dev/null',
    'for u in head base64 tr; do',
    `  command -v "$u" >/dev/null || { printf '%s missing %s\\n' "$V" "$u"; exit ${MISSING_UTILITY_EXIT}; }`,
    'done',
    'cd -P . || exit 4',
    'walk() {',
    '  p=; rest=$1; k=0',
    '  while :; do',
    '    case $rest in */*) c=${rest%%/*}; rest=${rest#*/};; *) c=$rest; rest=;; esac',
    '    k=$((k + 1))',
    '    if [ -z "$p" ]; then q=$c; else q=$p/$c; fi',
    '    if [ -L "$q" ]; then r="link $k"; return; fi',
    '    if [ ! -e "$q" ]; then',
    '      d=${p:-.}',
    '      if [ -d "$d" ] && [ -x "$d" ]; then r=absent; else r="denied $k"; fi',
    '      return',
    '    fi',
    '    if [ -z "$rest" ]; then',
    '      if [ -f "$q" ]; then r=file; elif [ -d "$q" ]; then r=dir; else r=special; fi',
    '      return',
    '    fi',
    '    if [ ! -d "$q" ]; then r=absent; return; fi',
    '    p=$q',
    '  done',
    '}',
    'mode=$1; shift',
    'case $mode in',
    'inspect)',
    '  printf \'%s inspect %s\\n\' "$V" "$#"',
    '  i=0',
    '  for a in "$@"; do walk "$a"; printf \'%s %s\\n\' "$i" "$r"; i=$((i + 1)); done',
    '  printf \'%s end\\n\' "$V";;',
    'read)',
    '  walk "$1"',
    '  if [ "$r" != file ]; then printf \'%s read %s\\n%s end\\n\' "$V" "$r" "$V"; exit 0; fi',
    // a failed open ends the subshell before it printed anything
    '  ( exec 3< "$1"',
    '    printf \'%s read file\\n\' "$V"',
    `    { head -c ${INSTRUCTION_SOURCE_MAX_BYTES + 1} <&3; printf '%s head %s\\n' "$V" "$?" >&4; } | base64 | tr -d '\\n'`,
    '    printf \'\\n%s end\\n\' "$V"',
    '  ) || printf \'%s read denied\\n%s end\\n\' "$V" "$V";;',
    '*) exit 5;;',
    'esac',
].join('\n');
