/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { posix } from 'node:path';
import { ValidationError } from '@chamvi/core';
import { WORKSPACE_ROOT } from '../workspace/constants.ts';

/**
 * The POSIX path of `path` relative to the workspace root (`'.'` for the
 * root). `path` is relative to the root or starts with `/workspace/`.
 * ValidationError for an empty path, a NUL byte, any other absolute path and
 * any path that leaves the root.
 */
export function resolveWorkspacePath(path: string): string {
    if (typeof path !== 'string' || path.length === 0) {
        throw new ValidationError('path must be a non-empty string.');
    }

    if (path.includes('\0')) {
        throw new ValidationError('path must not contain a NUL byte.');
    }

    let relative = path;

    if (relative === WORKSPACE_ROOT) {
        relative = '.';
    } else if (relative.startsWith(`${WORKSPACE_ROOT}/`)) {
        // `/workspace//src` names `/workspace/src`, as on POSIX.
        relative = relative.slice(WORKSPACE_ROOT.length + 1).replace(/^\/+/, '') || '.';
    }

    if (relative.startsWith('/')) {
        throw new ValidationError(`path must be relative to the workspace or under ${WORKSPACE_ROOT}/, got ${JSON.stringify(path)}.`);
    }

    let normalized = posix.normalize(relative);

    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    if (normalized === '..' || normalized.startsWith('../')) {
        throw new ValidationError(`path must stay inside the workspace, got ${JSON.stringify(path)}.`);
    }

    return normalized;
}

/** The absolute path of a workspace-relative one (`'.'` is the root), as the model names it. */
export function absoluteWorkspacePath(relative: string): string {
    return relative === '.' ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}/${relative}`;
}
