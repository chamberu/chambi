/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * The workspace credential helper, installed as
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
