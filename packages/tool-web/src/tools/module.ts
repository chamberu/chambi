/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { resolveOptions } from './asserts.ts';
import { webFetchTool } from './fetch.ts';
import { packageInfoTool } from './package.ts';
import { webSearchTool } from './search.ts';
import type { WebToolsOptions } from './types.ts';

/**
 * The web research tools: web_fetch, package_info and, with a `search`
 * provider, web_search. They run in the
 * chamvi process (not in a workspace) and reach public addresses only,
 * unless `allowUrl` opens more (or `registries` names a private mirror). Plain chamvi tools, not effect tools: they change nothing.
 */
export function webTools(options: WebToolsOptions = {}): ToolSet {
    const resolved = resolveOptions(options);
    return {
        web_fetch: webFetchTool(resolved),
        package_info: packageInfoTool(resolved),
        ...(resolved.search ? { web_search: webSearchTool(resolved, resolved.search) } : {}),
    };
}
