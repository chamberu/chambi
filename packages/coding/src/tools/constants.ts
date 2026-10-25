/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { JSONSchema7 } from 'ai';

/** Lines `read_file` returns at most (its `limit` default and maximum). */
export const READ_MAX_LINES = 2_000;

/** Characters `read_file` returns at most. */
export const READ_MAX_CHARS = 65_536;

/** Matches `grep` returns at most (the maximum of its `limit`). */
export const SEARCH_MAX_RESULTS = 500;

/** The default `limit` of `grep`. */
export const SEARCH_DEFAULT_RESULTS = 100;

/** Files `list_files` returns at most (the maximum of its `limit`). */
export const LIST_MAX_RESULTS = 5_000;

/** The default `limit` of `list_files`. */
export const LIST_DEFAULT_RESULTS = 1_000;

/** Characters of one `grep` match line. */
export const LINE_MAX_CHARS = 500;

/** Characters of git's stderr an error message carries. */
export const GIT_ERROR_MAX_CHARS = 2_000;

/** The `path` property of the file tools. */
export const FILE_PATH_PROPERTY: JSONSchema7 = {
    type: 'string',
    minLength: 1,
    description: 'A file path relative to the workspace root, or starting with /workspace/.',
};

/** The `workspace` property every coding tool takes. */
export const WORKSPACE_PROPERTY: JSONSchema7 = {
    type: 'string',
    minLength: 1,
    description: 'The workspace id from create_workspace. Omit it when the run holds only one workspace.',
};

/** Bytes of the start of a stream a result shows when the output was cut. */
export const EXCERPT_HEAD_BYTES = 8_192;

/** Bytes of the end of a stream a result shows when the output was cut. */
export const EXCERPT_TAIL_BYTES = 24_576;

/**
 * Log files `bash` keeps in `~/.chamvi/out/` (two per call, one per stream);
 * older ones are deleted at each call.
 */
export const OUTPUT_LOGS_KEPT = 100;

/**
 * The logs of `~/.chamvi/out/` take at most this many times
 * `outputLogMaxBytes` in all (256 MiB by default): past it each call deletes
 * the oldest ones but its own, since a hardened workspace's HOME is the
 * `/tmp` tmpfs (1 GiB by default).
 */
export const OUTPUT_LOGS_BUDGET_CAPS = 4;

/**
 * Bytes one output log of `bash` may grow to (the `outputLogMaxBytes`
 * default of `codingTools()`): past it the call is killed and the log cut
 * back to it, so a runaway writer cannot fill the disk until its timeout.
 */
export const OUTPUT_LOG_MAX_BYTES = 64 * 1_048_576;

/** Seconds between two checks of the log sizes while a `bash` call runs (`sleep 1` where fractions fail). */
export const OUTPUT_LOG_CHECK_SECONDS = '0.2';

/** Seconds between two checks of the output size while a background job runs (it may run for days). */
export const JOB_OUTPUT_CHECK_SECONDS = '1';

/** How long reading the logs of a command that timed out may take. */
export const REPORT_TIMEOUT_MS = 30_000;

/** The first line of a `bash` report on stdout. */
export const REPORT_HEADER = 'chamvi-report';

/** The first line of the stderr part of a `bash` report. */
export const REPORT_STDERR_HEADER = 'chamvi-report-stderr';

/** What the `bash` script prints instead of running when the explicit cwd is no directory. */
export const CWD_MISSING = 'chamvi-cwd-missing';

/** The exit code of a `bash` script that could not write its state folders or its report (no space left, or not writable). */
export const REPORT_FAILED_EXIT_CODE = 125;

/** The word after the status of a report header when a log passed its cap. */
export const REPORT_CAPPED = 'capped';

/** Ends a base64 block of a report. */
export const BLOCK_END = '-';

/**
 * Takes `<command> <cwd> <state dir>`, drops the positional parameters,
 * restores the exported variables (`export -p` of the last call) and the
 * working directory (an explicit `cwd` wins). An env file that does not
 * parse (`sh -n`) is removed instead of sourced, since a syntax error in a
 * sourced file ends a POSIX shell such as dash before the command ran and
 * before anything saved a whole one.
 */
const RESTORE_PART = [
    '__chamvi_c=$1; __chamvi_d=$2; __chamvi_s=$3; set --',
    'if [ -f "$__chamvi_s/env" ]; then if sh -n "$__chamvi_s/env" >/dev/null 2>&1; then . "$__chamvi_s/env" 2>/dev/null; ' +
    'else rm -f "$__chamvi_s/env"; fi; fi',
    'if [ -n "$__chamvi_d" ]; then cd -- "$__chamvi_d" || exit 1; ' +
    'elif [ -f "$__chamvi_s/cwd" ]; then IFS= read -r __chamvi_w < "$__chamvi_s/cwd"; cd -- "$__chamvi_w" 2>/dev/null; unset __chamvi_w; fi',
].join('\n');

/**
 * The inner shell of a `bash` call, run as `<bash or sh> -c INNER_SCRIPT
 * chamvi <command> <cwd> <state dir>`: restores the exported variables
 * (`export -p` of the last call) and the working directory (an explicit
 * `cwd` wins and is not kept), runs the command with `eval` in this shell
 * without positional parameters, and saves `pwd -P` and `export -p`
 * atomically after it and in an EXIT trap (each through a temporary file
 * of its own process, so parallel calls of one step never write one file
 * at once: the last rename wins), so an `exit` or `set -e` inside
 * keeps the state consistent. Names start with `__chamvi_` so the command
 * does not overwrite them by accident.
 */
export const INNER_SCRIPT = [
    RESTORE_PART,
    '__chamvi_save() {',
    '  set +eu',
    '  if [ -z "$__chamvi_d" ]; then pwd -P > "$__chamvi_s/cwd.t.$$" 2>/dev/null && mv -f "$__chamvi_s/cwd.t.$$" "$__chamvi_s/cwd"; fi',
    '  export -p > "$__chamvi_s/env.t.$$" 2>/dev/null && mv -f "$__chamvi_s/env.t.$$" "$__chamvi_s/env"',
    '}',
    'trap \'__chamvi_st=$?; __chamvi_save; exit $__chamvi_st\' EXIT',
    'eval "$__chamvi_c"',
    '__chamvi_st=$?',
    '__chamvi_save',
    'exit $__chamvi_st',
].join('\n');

/**
 * Prints the report of call `$n` (logs `$f.stdout.log` and `$f.stderr.log`,
 * cut back to `$m` bytes when the marker `$f.capped` says a log passed
 * that cap). First it deletes all but the newest `OUTPUT_LOGS_KEPT` logs,
 * then, while `du` finds the folder above `$b` bytes, the oldest ones past
 * that budget (counted newest first, this call's own logs never deleted),
 * so the report has room. Then it writes the report to two files and checks
 * that each ends whole (two `BLOCK_END` lines): a full disk or a folder that
 * takes no file is a stderr message and exit `REPORT_FAILED_EXIT_CODE`,
 * never a half report. The report: on stdout `REPORT_HEADER <status>` (plus
 * `REPORT_CAPPED` after a cap), the working directory the next call starts
 * in (as `/workspace/...` below the root `$r`), then for stdout its size and
 * log path and the base64 of its first `EXCERPT_HEAD_BYTES` and of the rest
 * or its last `EXCERPT_TAIL_BYTES`, each block ended by a `BLOCK_END` line;
 * the same for stderr on stderr after a `REPORT_STDERR_HEADER` line.
 */
const REPORT_PART = [
    'w=$r; if [ -f "$s/cwd" ]; then IFS= read -r w < "$s/cwd"; fi',
    'case $w in "$r") w=/workspace;; "$r"/*) w="/workspace${w#"$r"}";; esac',
    `q=; if [ -f "$f.capped" ]; then q=' ${  REPORT_CAPPED  }'; rm -f "$f.capped"; ` +
    'for g in "$f.stdout.log" "$f.stderr.log"; do if [ -n "$(find "$g" -size +"$m"c 2>/dev/null)" ]; then ' +
    'head -c "$m" "$g" > "$g.t" && mv -f "$g.t" "$g" || rm -f "$g.t"; fi; done; fi',
    `ls -1t "$o" | tail -n +${OUTPUT_LOGS_KEPT + 1} | while IFS= read -r g; do case $g in "$n".*) ;; *) rm -f -- "$o/$g";; esac; done`,
    'if [ "$(du -sk "$o" 2>/dev/null | cut -f1)" -gt "$((b / 1024))" ] 2>/dev/null; then',
    '  a=0; for g in "$f.stdout.log" "$f.stderr.log"; do if [ -f "$g" ]; then a=$((a + $(wc -c < "$g" | tr -d " "))); fi; done',
    '  ls -1t "$o" | while IFS= read -r g; do case $g in "$n".*) continue;; esac; ' +
    'z=$(wc -c < "$o/$g" 2>/dev/null | tr -d " "); a=$((a + ${z:-0})); if [ "$a" -gt "$b" ]; then rm -f -- "$o/$g"; fi; done',
    'fi',
    'for k in stdout stderr; do',
    '  g=$f.$k.log; z=0; if [ -f "$g" ]; then z=$(wc -c < "$g" | tr -d " "); fi',
    '  {',
    '    printf \'%s %s\\n\' "$z" "~/.chamvi/out/$n.$k.log"',
    `    if [ "$z" -gt 0 ]; then head -c ${EXCERPT_HEAD_BYTES} "$g" | base64; fi; printf '%s\\n' ${BLOCK_END}`,
    `    if [ "$z" -gt ${EXCERPT_HEAD_BYTES + EXCERPT_TAIL_BYTES} ]; then tail -c ${EXCERPT_TAIL_BYTES} "$g" | base64; ` +
    `elif [ "$z" -gt ${EXCERPT_HEAD_BYTES} ]; then tail -c +${EXCERPT_HEAD_BYTES + 1} "$g" | base64; fi; printf '%s\\n' ${BLOCK_END}`,
    '  } > "$o/.report.$n.$k" 2>/dev/null',
    'done',
    `if [ "$(grep -c -e '^${BLOCK_END}$' "$o/.report.$n.stdout" 2>/dev/null)" != 2 ] || ` +
    `[ "$(grep -c -e '^${BLOCK_END}$' "$o/.report.$n.stderr" 2>/dev/null)" != 2 ]; then`,
    '  rm -f "$o/.report.$n.stdout" "$o/.report.$n.stderr"',
    `  printf 'cannot write the bash report in %s\\n' "$o" >&2; exit ${REPORT_FAILED_EXIT_CODE}`,
    'fi',
    `printf '%s %s%s\\n%s\\n' ${REPORT_HEADER} "$st" "$q" "$w"`,
    `printf '%s\\n' ${REPORT_STDERR_HEADER} >&2`,
    'cat "$o/.report.$n.stdout"; cat "$o/.report.$n.stderr" >&2; rm -f "$o/.report.$n.stdout" "$o/.report.$n.stderr"',
].join('\n');

/**
 * A watchdog subshell, started in the background (`... &`): every `seconds`
 * (`sleep 1` where fractions fail) it runs `check`. The sleep runs in the
 * background so the TERM trap can kill and reap it, since an orphaned sleep
 * is a zombie for good under a PID 1 that reaps nothing (an image without
 * an init); the caller ends it with `kill "$wd"; wait "$wd"`.
 */
function watchdogPart(seconds: string, check: string): string {
    return '( p=; trap \'if [ -n "$p" ]; then kill "$p" 2>/dev/null; fi; wait; exit 0\' TERM; while :; do ' +
        `sleep ${seconds} 2>/dev/null & p=$!; wait "$p" || { sleep 1 & p=$!; wait "$p"; }; p=; ${check}; ` +
        'done ) > /dev/null 2>&1 < /dev/null &';
}

/** The folders of the shell state and the logs, `$c`, `$s` and `$o`, created when missing. */
const STATE_PART = `c=$HOME/.chamvi; s=$c/shell; o=$c/out; mkdir -p "$s" "$o" || exit ${REPORT_FAILED_EXIT_CODE}; r=$(pwd -P)`;

/**
 * The outer shell of a `bash` call, run in the workspace root as `sh -c
 * BASH_SCRIPT sh <INNER_SCRIPT> <command> <id> <cwd or ''> <log cap> <log
 * budget>`: it holds the exec's pipes while the inner shell (bash when the
 * image has it, else sh) writes to the log files only, so a background job
 * of the command never keeps the call open; then it prints the report. A
 * watchdog in the background checks the log sizes every
 * `OUTPUT_LOG_CHECK_SECONDS` while the inner shell runs; once a log passed
 * the cap it leaves the marker `$f.capped` and kills the exec's process
 * group (the command, its jobs and this shell, like a timeout), so the
 * report is read afterwards with REPORT_SCRIPT.
 */
export const BASH_SCRIPT = [
    STATE_PART,
    'n=$3; f=$o/$n; m=$5; b=$6',
    `if [ -n "$4" ] && [ ! -d "$4" ]; then printf '%s\\n' ${CWD_MISSING}; exit 0; fi`,
    'if command -v bash >/dev/null 2>&1; then x=bash; else x=sh; fi',
    watchdogPart(
        OUTPUT_LOG_CHECK_SECONDS,
        'if [ -n "$(find "$f.stdout.log" "$f.stderr.log" -size +"$m"c 2>/dev/null)" ]; then : > "$f.capped"; kill -KILL 0; fi',
    ),
    'wd=$!',
    '"$x" -c "$1" chamvi "$2" "$4" "$s" > "$f.stdout.log" 2> "$f.stderr.log" < /dev/null',
    'st=$?',
    'kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null',
    REPORT_PART,
    'exit $st',
].join('\n');

/**
 * The report of call `$1` alone, run as `sh -c REPORT_SCRIPT sh <id> <log
 * cap> <log budget>` after the call was killed (its timeout or its log cap):
 * the status reads `-`.
 */
export const REPORT_SCRIPT = [
    STATE_PART,
    'n=$1; f=$o/$n; m=$2; b=$3; st=-',
    REPORT_PART,
].join('\n');

/**
 * The files of `~/.chamvi/` the file and search tools may read besides the
 * workspace: the output logs of `bash` and the output of a background job.
 * Group 1 is the path below `$HOME`.
 */
export const HOME_LOG_PATTERN = /^~\/(\.chamvi\/(?:out\/[0-9a-f]{12}\.(?:stdout|stderr)\.log|jobs\/[0-9a-f]{12}\/output))$/;

/**
 * Prints lines `$2` to `$3` of `$HOME/$1` on stdout and the file's line
 * count as the last line of stderr; exit 3 when it does not exist.
 */
export const READ_LOG_SCRIPT = [
    'f=$HOME/$1',
    'if [ ! -f "$f" ]; then exit 3; fi',
    'awk -v s="$2" -v e="$3" \'NR >= s && NR <= e { print } END { print NR > "/dev/stderr" }\' "$f"',
].join('\n');

/** Bytes of job output `bash_output` returns at most. */
export const JOB_OUTPUT_MAX_BYTES = 32_768;

/** A job id: 12 hex characters. */
export const JOB_ID_PATTERN = /^[0-9a-f]{12}$/;

/** The first line of a job script's answer. */
export const JOB_HEADER = 'chamvi-job';

/** The inner shell of a background job: the restored state, then the command (nothing saved). */
export const JOB_INNER_SCRIPT = [
    RESTORE_PART,
    'eval "$__chamvi_c"',
].join('\n');

/** `pgof <pid>`: the process group of a process, from `/proc` (Linux) or `ps` (macOS); empty when it is gone. */
const PGOF_PART = 'pgof() { if [ -r "/proc/$1/stat" ]; then sed \'s/.*) //\' "/proc/$1/stat" 2>/dev/null | cut -d" " -f3; ' +
    'else ps -o pgid= -p "$1" 2>/dev/null | tr -d " "; fi; }';

/**
 * Starts a background job, run as `sh -c JOB_START_SCRIPT sh
 * <JOB_INNER_SCRIPT> <command> <id> <cwd or ''> <log cap>` in its own exec,
 * so the job lives in that exec's process group (the local spawn's group,
 * GNU `timeout`'s in a container) and outlives the exec: `$j/pgid` holds
 * the group, `$j/pid` the wrapper that waits for the command and writes its
 * exit status to `$j/status`; stdout and stderr go to `$j/output`. A
 * watchdog of the wrapper checks the output every `JOB_OUTPUT_CHECK_SECONDS`
 * while the command runs; once it passed the log cap it leaves
 * `$j/capped`, cuts the file back to the cap (the job writes on into the
 * replaced file until the kill) and kills the job's process group, like
 * bash_kill. The job's pipes never are the exec's, so the exec returns at
 * once.
 */
export const JOB_START_SCRIPT = [
    'c=$HOME/.chamvi; s=$c/shell; j=$c/jobs/$3; m=$5; mkdir -p "$s" "$j" || exit 125',
    `if [ -n "$4" ] && [ ! -d "$4" ]; then printf '%s\\n' ${CWD_MISSING}; exit 0; fi`,
    PGOF_PART,
    'g=$(pgof $$)',
    'case $g in ""|*[!0-9]*|0|1) printf \'cannot read the process group\\n\' >&2; exit 125;; esac',
    'printf \'%s\\n\' "$g" > "$j/pgid"; printf \'%s\\n\' "$2" > "$j/command"',
    'if command -v bash >/dev/null 2>&1; then x=bash; else x=sh; fi',
    '(',
    `  ${watchdogPart(
        JOB_OUTPUT_CHECK_SECONDS,
        'if [ -n "$(find "$j/output" -size +"$m"c 2>/dev/null)" ]; then : > "$j/capped"; ' +
        'head -c "$m" "$j/output" > "$j/output.t" && mv -f "$j/output.t" "$j/output" || rm -f "$j/output.t"; kill -KILL 0; fi',
    )}`,
    '  wd=$!',
    '  "$x" -c "$1" chamvi "$2" "$4" "$s" > "$j/output" 2>&1 < /dev/null',
    '  e=$?',
    '  kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null',
    '  echo $e > "$j/status.t" && mv -f "$j/status.t" "$j/status"',
    ') > /dev/null 2>&1 < /dev/null &',
    'printf \'%s\\n\' "$!" > "$j/pid"',
    `printf '%s %s\\n' ${JOB_HEADER} "$g"`,
].join('\n');

/**
 * Prints `JOB_HEADER <size> <status> <capped 0|1> [exit code]` of job `$1`
 * (status `killed` once bash_kill or the log cap ended it, `exited` with the
 * code, `running` while its wrapper lives in the job's group, else `lost`:
 * the container restarted). Exit 3 for an unknown job.
 */
const JOB_STATE_PART = [
    'j=$HOME/.chamvi/jobs/$1; if [ ! -f "$j/pgid" ]; then exit 3; fi',
    PGOF_PART,
    'IFS= read -r g < "$j/pgid"; p=; if [ -f "$j/pid" ]; then IFS= read -r p < "$j/pid"; fi',
    'e=; if [ -f "$j/status" ]; then IFS= read -r e < "$j/status"; fi',
    'if [ -f "$j/killed" ] || [ -f "$j/capped" ]; then t=killed; elif [ -n "$e" ]; then t=exited; ' +
    'elif [ -n "$p" ] && [ "$(pgof "$p")" = "$g" ]; then t=running; else t=lost; fi',
    'z=0; if [ -f "$j/output" ]; then z=$(wc -c < "$j/output" | tr -d " "); fi',
    'u=0; if [ -f "$j/capped" ]; then u=1; fi',
].join('\n');

/**
 * The state of job `$1` and the base64 of at most `$3` bytes of its output
 * from byte `$2`, run as `sh -c JOB_OUTPUT_SCRIPT sh <id> <offset> <max>`.
 */
export const JOB_OUTPUT_SCRIPT = [
    JOB_STATE_PART,
    `printf '%s %s %s %s %s\\n' ${JOB_HEADER} "$z" "$t" "$u" "$e"`,
    'if [ "$z" -gt "$2" ]; then tail -c "+$(($2 + 1))" "$j/output" | head -c "$3" | base64; fi',
].join('\n');

/**
 * Kills job `$1` unless it exited or is lost: marks it killed, sends TERM to
 * its process group, waits up to 3 s for the group to end, then sends KILL.
 * Prints the state like JOB_OUTPUT_SCRIPT, without output.
 */
export const JOB_KILL_SCRIPT = [
    JOB_STATE_PART,
    'if [ "$t" = running ]; then',
    '  : > "$j/killed"; t=killed',
    '  kill -TERM "-$g" 2>/dev/null',
    '  i=0; while kill -0 "-$g" 2>/dev/null && [ $i -lt 30 ]; do sleep 0.1; i=$((i + 1)); done',
    '  kill -KILL "-$g" 2>/dev/null',
    'fi',
    `printf '%s %s %s %s %s\\n' ${JOB_HEADER} "$z" "$t" "$u" "$e"`,
].join('\n');

/** Bytes a `read_file` with `encoding: 'base64'` returns at most. */
export const BINARY_MAX_BYTES = 1_048_576;

/** Bytes of an image `read_file` hands the model as an image part at most. */
export const IMAGE_MAX_BYTES = 5 * 1_048_576;

/** Edits one `multi_edit` call takes at most. */
export const MULTI_EDIT_MAX_EDITS = 100;

/** Bytes of one match line the grep script keeps, before the cut to `LINE_MAX_CHARS`. */
export const GREP_LINE_MAX_BYTES = 2_000;

/**
 * Searches for `$1` in `$2` (below `$HOME` when `$5` is `home`), run as `sh
 * -c GREP_SCRIPT sh <pattern> <path> <ignoreCase 0|1> <includeIgnored 0|1>
 * <home|''>`: with ripgrep when the image has it (hidden files too, `.git`
 * never, ignored files with `--no-ignore`), else `git grep` in a work tree
 * (`--no-exclude-standard` for ignored files), else `grep -r` without
 * `.git`, or for a grep without `--null` (BusyBox) one `grep` per file
 * that names the file itself. Prints the engine on the first line, then
 * one `path NUL line (':' or NUL) text` record per match, each cut at
 * `GREP_LINE_MAX_BYTES` (a minified line must not fill the output; ripgrep
 * by `--max-columns`, the others by `cut` when it keeps NUL bytes, which
 * BusyBox's does not), and exits with the engine's status.
 */
export const GREP_SCRIPT = [
    'pat=$1; p=$2; ic=$3; ig=$4; if [ "$5" = home ]; then p=$HOME/$2; fi; nn=',
    'if command -v rg >/dev/null 2>&1; then',
    `  e=ripgrep; set -- rg -n --null --no-heading --with-filename --color never --max-columns ${GREP_LINE_MAX_BYTES} --max-columns-preview --hidden --glob '!.git'`,
    '  if [ "$ig" = 1 ]; then set -- "$@" --no-ignore; fi',
    'elif [ "$5" != home ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  e=git-grep; set -- git --literal-pathspecs grep -z -n -I --untracked --no-color -E',
    '  if [ "$ig" = 1 ]; then set -- "$@" --no-exclude-standard; fi',
    'elif printf \'x\\n\' | grep --null -q -e x >/dev/null 2>&1; then',
    '  e=grep; set -- grep -r -n -I -H --null -E --exclude-dir=.git',
    'else',
    '  e=grep; nn=1; set -- grep -n -I -E',
    'fi',
    'if [ "$ic" = 1 ]; then set -- "$@" -i; fi',
    `if [ "$(printf 'a\\0b\\n' | cut -c 1-3 2>/dev/null | tr '\\0' Z)" = aZb ]; then cl() { cut -c 1-${GREP_LINE_MAX_BYTES}; }; else cl() { cat; }; fi`,
    'printf \'%s\\n\' "$e"',
    'if [ -n "$nn" ]; then',
    // BusyBox compiles the pattern at the first line: one line shows a pattern it refuses
    '  printf \'x\\n\' | "$@" -e "$pat" >/dev/null || [ $? -eq 1 ] || exit 2',
    '  find "$p" -name .git -prune -o -type f -print | while IFS= read -r f; do',
    '    "$@" -e "$pat" -- "$f" 2>/dev/null | while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\0%s\\n\' "$f" "$l"; done',
    '  done | cl',
    '  exit 0',
    'fi',
    'set -- "$@" -e "$pat" -- "$p"',
    '{ st=$( { { "$@"; echo $? >&3; } | cl >&4; } 3>&1 ); } 4>&1',
    'exit "$st"',
].join('\n');
