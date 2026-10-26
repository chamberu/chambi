/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { resolveOptions } from '../options/module.ts';
import type { WebToolsOptions } from '../options/types.ts';
import { webFetchTool } from './fetch.ts';

/**
 * The web tools: `web_fetch` (a public http(s) page as markdown, text or
 * raw). Options are checked when called (InvalidAgentDefinitionError).
 */
export function webTools(options: WebToolsOptions = {}): ToolSet {
    const resolved = resolveOptions(options);
    return { web_fetch: webFetchTool(resolved) };
}
