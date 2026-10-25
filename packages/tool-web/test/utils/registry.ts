/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ControllableClock } from '@chamvi/test-kit';
import { webTools } from '@chamvi/tool-web';
import type { PackageInfo, WebToolsOptions } from '@chamvi/tool-web';
import { callTool, toolContext } from './context.ts';
import { createFakeWeb } from './web.ts';

/** webTools over a fake web, and `info(input)` calling package_info. */
export function createRegistryFixture(options: WebToolsOptions = {}) {
    const web = createFakeWeb();
    const tools = webTools({
        fetch: web.fetch,
        lookup: web.lookup,
        clock: new ControllableClock(),
        ...options,
    });
    const ctx = toolContext('run-1');
    const info = (input: unknown) => callTool<PackageInfo>(tools, 'package_info', input, ctx);
    return { web, info };
}

/** The error a promise rejects with. */
export async function rejection(promise: Promise<unknown>): Promise<Error & { code?: string }> {
    try {
        await promise;
    } catch (error) {
        return error as Error & { code?: string };
    }
    throw new Error('expected a rejection');
}
