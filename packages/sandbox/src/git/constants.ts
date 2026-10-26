/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * The helper of one authenticated git call: answers `get` with the
 * credential on fd 3 only for the origin and path the call was made for
 * (`CHAMVI_GIT_ORIGIN`, `CHAMVI_GIT_PATH`, set by `GIT_AUTH_SCRIPT`), so a
 * rewritten URL never hands it to another host. git appends the action (`get`, `store`, `erase`).
 */
const ONE_SHOT_HELPER = '!f() { test "$1" = get || return 0; q= h= r=; ' +
    'while IFS= read -r l; do test -z "$l" && break; case $l in protocol=*) q=${l#protocol=};; host=*) h=${l#host=};; path=*) r=${l#path=};; esac; done; ' +
    'r=${r%/}; r=${r%.git}; test "$q://$h" = "$CHAMVI_GIT_ORIGIN" && test "$r" = "$CHAMVI_GIT_PATH" && cat <&3; return 0; }; f';

/** The exit code of `GIT_AUTH_SCRIPT` when the git config would send the credential elsewhere. */
export const GIT_AUTH_REFUSED_EXIT = 3;

/**
 * The git config the credential is never sent through, checked for the
 * repository URL as git resolves it (URL-specific keys of the repository's
 * or the global config beat a generic `-c`, so they cannot be overridden,
 * only refused): a proxy, TLS verification off, another CA, a resolve
 * override, a proxy of the remote, and any URL rewrite (`insteadOf`,
 * `pushInsteadOf`), which would take git to another URL than the one
 * checked.
 */
const CONFIG_CHECKS = [
    'set -f',
    'g() { git -c credential.helper= -c core.hooksPath=/dev/null -c http.proxy= -c http.sslVerify=true "$@"; }',
    'bad=',
    'for k in http.proxy http.sslCAInfo http.sslCAPath http.curloptResolve; do',
    '  test -n "$(g config --get-urlmatch "$k" "$url" 2>/dev/null)" && bad="$bad $k"',
    'done',
    'test "$(g config --type=bool --get-urlmatch http.sslVerify "$url" 2>/dev/null)" = false && bad="$bad http.sslVerify"',
    'for k in $(g config --name-only --get-regexp \'^remote\\..*\\.proxy$\' . 2>/dev/null) ' +
        '$(g config --name-only --get-regexp \'^url\\..*\\.(push)?insteadof$\' 2>/dev/null); do bad="$bad $k"; done',
    'if [ -n "$bad" ]; then',
    '  printf \'chamvi: the git config sets%s for %s, so the credential is not sent; remove it (git config --unset <key>, also --global) and try again.\\n\' "$bad" "$url" >&2',
    `  exit ${GIT_AUTH_REFUSED_EXIT}`,
    'fi',
];

/**
 * Runs `git <args>` with a credential read from stdin, never putting it in
 * argv, a file, the environment or the remote config: `sh -c` with `$1` the
 * repository URL, `$2` its origin (`https://host[:port]`), `$3` its path and
 * the git arguments after them; stdin is `<username>\n<password>\n`. The
 * credential reaches git's helper through a pipe on fd 3. Every configured
 * helper is reset, hooks are off and the URL path goes to the helper. Before
 * git runs, the config is checked for the URL (`CONFIG_CHECKS`): exit
 * `GIT_AUTH_REFUSED_EXIT` with the keys on stderr when it sets a proxy, turns
 * TLS verification off, names another CA or rewrites URLs. git hands fd 3 to
 * every helper it spawns, so `GIT_ALLOW_PROTOCOL=https` (the environment beats
 * any config, unlike `-c protocol.allow`) keeps a transport the config names
 * (`remote.<url>.vcs`, run as `git-remote-<vcs>`) from starting and reading
 * the credential. Exit 125 when stdin holds no credential.
 */
export const GIT_AUTH_SCRIPT = [
    'IFS= read -r u || exit 125',
    'IFS= read -r p || exit 125',
    'url=$1 CHAMVI_GIT_ORIGIN=$2 CHAMVI_GIT_PATH=$3',
    'export CHAMVI_GIT_ORIGIN CHAMVI_GIT_PATH',
    'shift 3',
    'GIT_ALLOW_PROTOCOL=https',
    'export GIT_ALLOW_PROTOCOL',
    ...CONFIG_CHECKS,
    `h='${ONE_SHOT_HELPER}'`,
    'printf \'username=%s\\npassword=%s\\n\' "$u" "$p" | { exec 3<&0 </dev/null; ' +
        'exec git -c credential.helper= -c "credential.helper=$h" -c credential.useHttpPath=true ' +
        '-c core.hooksPath=/dev/null -c http.proxy= -c http.sslVerify=true "$@"; }',
].join('\n');

/**
 * The credential helper of `credentialMode: 'workspace'`, installed as
 * `$HOME/.chamvi/git-credential`: answers `get` from
 * `$HOME/.chamvi/credentials` (`<origin>/<path>\t<username>\t<password>`
 * lines), the repository's line first, else its host's (`<origin>/`).
 */
export const CREDENTIAL_HELPER_SCRIPT = [
    'test "$1" = get || exit 0',
    'q= h= r=',
    'while IFS= read -r l; do test -z "$l" && break; case $l in protocol=*) q=${l#protocol=};; host=*) h=${l#host=};; path=*) r=${l#path=};; esac; done',
    'r=${r%/}; r=${r%.git}',
    'f=$HOME/.chamvi/credentials',
    'test -f "$f" || exit 0',
    't=$(printf \'\\t\')',
    'want="$q://$h/$r"; base="$q://$h/"; fu= fp=',
    'while IFS="$t" read -r k u p; do',
    '  if [ "$k" = "$want" ]; then printf \'username=%s\\npassword=%s\\n\' "$u" "$p"; exit 0; fi',
    '  if [ "$k" = "$base" ] && [ -z "$fu" ]; then fu=$u; fp=$p; fi',
    'done < "$f"',
    'if [ -n "$fu" ]; then printf \'username=%s\\npassword=%s\\n\' "$fu" "$fp"; fi',
    'exit 0',
].join('\n');

/**
 * Installs the workspace credential helper: `$1` the helper script, `$2`
 * the byte length of the credentials file on stdin (read with `head -c`, so
 * no stdin EOF is needed). Writes `$HOME/.chamvi/credentials` (0600, through
 * a temporary file) and `$HOME/.chamvi/git-credential`, and points the
 * global git config at it with the URL path.
 */
export const INSTALL_CREDENTIALS_SCRIPT = [
    'umask 077',
    'd=$HOME/.chamvi',
    'mkdir -p "$d" || exit 1',
    'head -c "$2" > "$d/credentials.tmp" && chmod 600 "$d/credentials.tmp" && mv -f "$d/credentials.tmp" "$d/credentials" || exit 1',
    'printf \'%s\\n\' "$1" > "$d/git-credential" || exit 1',
    'git config --global --replace-all credential.helper \'!sh "$HOME/.chamvi/git-credential"\' || exit 1',
    'git config --global credential.useHttpPath true',
].join('\n');

/**
 * Prints the workspace's credentials file (`$HOME/.chamvi/credentials`),
 * nothing when there is none: the tokens an earlier process installed.
 */
export const READ_CREDENTIALS_SCRIPT = 'f=$HOME/.chamvi/credentials; test -f "$f" && cat "$f"; exit 0';
