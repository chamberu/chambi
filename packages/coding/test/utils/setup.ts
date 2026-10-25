/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolSet } from 'ai';
import { codingTools } from '@chamvi/coding';
import type { CodingToolsOptions } from '@chamvi/coding';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { IWorkspace, IWorkspaceManager } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import { callTool, toolContext } from './context.ts';

export const FIXTURE_FILES: Record<string, string> = {
    'src/a.ts': 'export const a = 1;\nexport const b = 2;\n',
    '.gitignore': 'dist\n',
    'package.json': '{"scripts":{"test":"node test.js"}}',
    'test.js': 'console.error("1 failing"); process.exit(1);\n',
};

export type CodingSetup = {
    root: string;
    manager: IWorkspaceManager;
    workspace: IWorkspace;
    tools: ToolSet;
    /** Calls a coding tool as run `runId` (default r1). */
    call<T = unknown>(name: string, input: unknown, runId?: string, abortSignal?: AbortSignal): Promise<T>;
    cleanup(): Promise<void>;
};

export function createFixture(): Promise<GitFixture> {
    return createGitFixture(FIXTURE_FILES);
}

/** A manager over a local sandbox in a temp root, with run r1 holding a checkout of `fixture`. */
export async function setupCoding(fixture: GitFixture, options?: CodingToolsOptions): Promise<CodingSetup> {
    const root = await mkdtemp(join(tmpdir(), 'chamvi-coding-'));
    const manager = createWorkspaceManager({
        provider: createLocalSandbox({ root }),
        allowFileRepos: true,
        gcIntervalMs: 0,
    });
    const { workspace } = await manager.acquire('r1', { repo: fixture.url });
    const tools = codingTools(manager, options);
    return {
        root,
        manager,
        workspace,
        tools,
        call: (name, input, runId, abortSignal) => callTool(tools, name, input, toolContext(runId ?? 'r1'), abortSignal),
        cleanup: async () => {
            await manager.close();
            await rm(root, { recursive: true, force: true });
        },
    };
}
