/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * The helper of one authenticated git call: answers `get` with the
 * credential on fd 3 only for the origin and path the call was made for
 * (`CHAMVI_GIT_ORIGIN`, `CHAMVI_GIT_PATH`, set by `GIT_AUTH_SCRIPT`), so an
 * `insteadOf` or a proxy setting in the repository's config never hands it
 * to another host. git appends the action (`get`, `store`, `erase`).
 */
const ONE_SHOT_HELPER = '!f() { test "$1" = get || return 0; q= h= r=; ' +
    'while IFS= read -r l; do test -z "$l" && break; case $l in protocol=*) q=${l#protocol=};; host=*) h=${l#host=};; path=*) r=${l#path=};; esac; done; ' +
    'r=${r%/}; r=${r%.git}; test "$q://$h" = "$CHAMVI_GIT_ORIGIN" && test "$r" = "$CHAMVI_GIT_PATH" && cat <&3; return 0; }; f';

/**
 * Runs `git <args>` with a credential read from stdin, never putting it in
 * argv, a file, the environment or the remote config: `sh -c` with `$1` the
 * origin (`https://host[:port]`), `$2` the repository path and the git
 * arguments after them; stdin is `<username>\n<password>\n`. The credential
 * reaches git's helper through a pipe on fd 3. Every configured helper is
 * reset, hooks are off, the URL path goes to the helper and TLS verification
 * cannot be switched off by the repository's config. Exit 125 when stdin
 * holds no credential.
 */
export const GIT_AUTH_SCRIPT = [
    'IFS= read -r u || exit 125',
    'IFS= read -r p || exit 125',
    'CHAMVI_GIT_ORIGIN=$1 CHAMVI_GIT_PATH=$2',
    'export CHAMVI_GIT_ORIGIN CHAMVI_GIT_PATH',
    'shift 2',
    `h='${ONE_SHOT_HELPER}'`,
    'printf \'username=%s\\npassword=%s\\n\' "$u" "$p" | { exec 3<&0 </dev/null; ' +
        'exec git -c credential.helper= -c "credential.helper=$h" -c credential.useHttpPath=true ' +
        '-c core.hooksPath=/dev/null -c http.sslVerify=true "$@"; }',
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
