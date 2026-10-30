/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ToolSet } from 'ai';
import {
    EFFECT,
    SandboxError,
    ValidationError,
    toolContextSchema,
} from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { WorkspaceToolResult } from '@chamvi/sandbox';
import { DISCOVERY_SCRIPT } from '../../../src/instructions/constants.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { callTool, toolContext } from '../../utils/context.ts';
import { FAKE_COMMIT, createFakeProvider } from '../../utils/provider.ts';

function setup() {
    const clock = new ControllableClock(new Date(1_000_000));
    const provider = createFakeProvider({
        clock,
        onExec: (argv) => {
            expect(argv.slice(0, 5)).toEqual(['/bin/sh', '-c', DISCOVERY_SCRIPT, 'sh', 'inspect']);

            const paths = argv.slice(5);

            return { stdout: `chamvi-instructions/1 inspect ${paths.length}\n${paths.map((path, index) => `${index} ${path === '.' ? 'dir' : 'absent'}\n`).join('')}chamvi-instructions/1 end\n` };
        },
    });
    const manager = createWorkspaceManager({
        provider,
        clock,
        gcIntervalMs: 0,
    });

    return {
        provider,
        manager,
        tools: manager.tools(),
    };
}

describe('workspace tools', () => {
    it('offers structured Git operations without granting a bash tool', () => {
        const { tools } = setup();

        expect(Object.keys(tools)).toEqual(expect.arrayContaining(['git_fetch', 'git_pull', 'git_push']));
        expect(tools.bash).toBeUndefined();
    });

    it('create_workspace returns the workspace', async () => {
        const { provider, tools } = setup();
        const result = await callTool<WorkspaceToolResult>(tools, 'create_workspace', { repo: 'octo/demo', ref: 'v1' }, toolContext('r1'));
        const [id] = provider.workspaces.keys();

        expect(result).toEqual({
            workspace: id,
            root: '/workspace',
            repo: 'https://github.com/octo/demo.git',
            ref: 'v1',
            commit: FAKE_COMMIT,
            defaultBranch: 'main',
            image: null,
            expiresAt: new Date(1_000_000 + 604_800_000).toISOString(),
            reused: false,
            instructions: {
                commit: FAKE_COMMIT,
                paths: ['.'],
                sources: [],
                diagnostics: [],
                complete: true,
            },
        });
    });

    it('create_workspace without a repo', async () => {
        const { tools } = setup();
        const result = await callTool<WorkspaceToolResult>(tools, 'create_workspace', {}, toolContext('r1'));

        expect(result).toMatchObject({
            root: '/workspace',
            repo: null,
            ref: null,
            commit: null,
            defaultBranch: null,
            reused: false,
            instructions: null,
        });

        const again = await callTool<WorkspaceToolResult>(tools, 'create_workspace', {}, toolContext('r1'));

        expect(again.workspace).toBe(result.workspace);
        expect(again.reused).toBe(true);
    });

    it('create_workspace passes the run signal to create', async () => {
        const { provider, tools } = setup();
        const controller = new AbortController();

        await callTool(tools, 'create_workspace', {}, toolContext('r1', controller.signal));

        const { signal } = provider.created[0]!;

        expect(signal!.aborted).toBe(false);
        controller.abort();
        expect(signal!.aborted).toBe(true);
        expect(provider.created[0]!.runId).toBe('r1');
    });

    it('dispose_workspace releases', async () => {
        const {
            provider,
            manager,
            tools,
        } = setup();
        const { workspace } = await callTool<WorkspaceToolResult>(tools, 'create_workspace', {}, toolContext('r1'));
        const result = await callTool(tools, 'dispose_workspace', { workspace }, toolContext('r1'));

        expect(result).toEqual({ workspace, disposed: true });
        expect(provider.disposed).toEqual([workspace]);
        await expect(manager.get('r1', workspace)).rejects.toThrow(SandboxError);
    });

    it('dispose_workspace without an id disposes the only workspace', async () => {
        const { provider, tools } = setup();
        const { workspace } = await callTool<WorkspaceToolResult>(tools, 'create_workspace', {}, toolContext('r1'));

        await expect(callTool(tools, 'dispose_workspace', {}, toolContext('r1')))
            .resolves.toEqual({ workspace, disposed: true });
        expect(provider.disposed).toEqual([workspace]);
    });

    it('dispose_workspace never reaches another run', async () => {
        const { provider, tools } = setup();
        const { workspace } = await callTool<WorkspaceToolResult>(tools, 'create_workspace', {}, toolContext('r1'));

        await expect(callTool(tools, 'dispose_workspace', { workspace }, toolContext('r2')))
            .rejects.toThrow(/not found/);
        expect(provider.disposed).toEqual([]);
    });

    function propertiesOf(tools: ToolSet): string[] {
        const schema = tools.create_workspace!.inputSchema as { jsonSchema: { properties: Record<string, unknown> } };

        return Object.keys(schema.jsonSchema.properties);
    }

    it('offers no image parameter without an allow-list', () => {
        const { tools } = setup();

        expect(propertiesOf(tools)).toEqual(['repo', 'ref']);
    });

    it('offers the image parameter with an allow-list', () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const manager = createWorkspaceManager({
            provider: createFakeProvider({ clock }),
            clock,
            gcIntervalMs: 0,
            allowImage: () => true,
        });

        expect(propertiesOf(manager.tools())).toContain('image');
    });

    it('offers no image parameter on the local provider, even with an allow-list', () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const manager = createWorkspaceManager({
            provider: Object.assign(createFakeProvider({ clock }), { name: 'local' }),
            clock,
            gcIntervalMs: 0,
            allowImage: () => true,
        });

        expect(propertiesOf(manager.tools())).toEqual(['repo', 'ref']);
    });

    it('are chamvi tools and not effect tools', () => {
        const { tools } = setup();

        expect(Object.keys(tools).sort()).toEqual(['create_workspace', 'dispose_workspace', 'git_fetch', 'git_pull', 'git_push', 'read_repository_instructions']);

        for (const tool of Object.values(tools)) {
            expect(tool.contextSchema).toBe(toolContextSchema);
            expect(EFFECT in tool).toBe(false);
        }
    });

    it('rejects a non-string repo', async () => {
        const { provider, tools } = setup();

        await expect(callTool(tools, 'create_workspace', { repo: 42 }, toolContext('r1'))).rejects.toThrow(ValidationError);
        await expect(callTool(tools, 'create_workspace', { ref: 42 }, toolContext('r1'))).rejects.toThrow(ValidationError);
        await expect(callTool(tools, 'create_workspace', 'octo/demo', toolContext('r1'))).rejects.toThrow(ValidationError);
        await expect(callTool(tools, 'dispose_workspace', { workspace: 7 }, toolContext('r1'))).rejects.toThrow(ValidationError);
        expect(provider.created).toEqual([]);
    });

    it('never echoes a token-carrying repository', async () => {
        const { tools } = setup();
        const error = await callTool(tools, 'create_workspace', { repo: 'https://user:token@github.com/o/r' }, toolContext('r1'))
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).not.toContain('token');
    });
});
