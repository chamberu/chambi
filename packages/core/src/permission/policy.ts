/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolPolicy } from '../agent/types.ts';
import { hasPermission, toolPermission } from './match.ts';
import type { RequireToolPermissionOptions } from './types.ts';

/**
 * A tool policy that offers a tool only when the run's invoker holds
 * `tool:<agent>:<tool>`; a run without an invoker follows `withoutInvoker`
 * (default `'deny'`). Wrap it for exceptions.
 */
export function requireToolPermission(options: RequireToolPermissionOptions = {}): ToolPolicy {
    const withoutInvoker = options.withoutInvoker ?? 'deny';

    return (toolName, { run }) => {
        const { invoker } = run.trigger;

        if (!invoker) {
            return withoutInvoker === 'allow';
        }

        return hasPermission(invoker.permissions, toolPermission(run.agent, toolName));
    };
}
