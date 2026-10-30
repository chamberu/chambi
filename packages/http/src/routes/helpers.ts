/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * The raw rest of `pathname` below `basePath` and the route's `path`
 * (matched case-insensitively, as routup does; the rest keeps its case and
 * percent-encoding): `''` for the path itself, else starting with `/`.
 */
export function routeSubpath(pathname: string, basePath: string, path: string): string {
    const prefix = `${basePath}${path}`;

    if (pathname.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) {
        return '';
    }

    return pathname.slice(prefix.length);
}
