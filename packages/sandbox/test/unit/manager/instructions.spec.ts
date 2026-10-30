/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { InvalidAgentDefinitionError, SandboxError, ValidationError } from '@chamvi/core';
import { createWorkspaceManager, staticGitCredentials } from '@chamvi/sandbox';
import type {
    ISandboxProvider,
    IWorkspaceManager,
    RepositoryInstructions,
    WorkspaceManagerOptions,
} from '@chamvi/sandbox';
import { callTool, toolContext } from '../../utils/context.ts';
import { createLocalFixture } from '../../utils/instructions.ts';
import type { LocalFixture } from '../../utils/instructions.ts';

type WorkspaceResult = {
    workspace: string;
    reused: boolean;
    instructions: RepositoryInstructions | null;
};

describe('workspace instruction delivery', () => {
    let fixture: LocalFixture;
    let manager: IWorkspaceManager;
    let provider: ISandboxProvider;

    beforeEach(async () => {
        fixture = await createLocalFixture();
        fixture.workspace.info.runId = 'r1';
        provider = {
            name: 'local',
            async create(options) {
                fixture.workspace.info.repo = options.repo;
                fixture.workspace.info.commit = options.repo ? 'a'.repeat(40) : undefined;

                return fixture.workspace;
            },
            async find() {
                return [];
            },
            async collectGarbage() {
                return 0;
            },
        };
        manager = createWorkspaceManager({ provider, gcIntervalMs: 0 });
    });

    afterEach(async () => {
        await manager.close();
        await fixture.dispose();
    });

    it('returns root guidance and its source hash from create_workspace', async () => {
        const content = 'Run the repository tests before finishing.\n';

        await fixture.write({ 'AGENTS.md': content });

        const result = await callTool<WorkspaceResult>(manager.tools(), 'create_workspace', { repo: 'octo/demo' }, toolContext('r1'));

        expect(result.workspace).toBe(fixture.workspace.id);
        expect(result.instructions?.sources).toEqual([{
            path: 'AGENTS.md',
            content,
            sha256: createHash('sha256').update(content).digest('hex'),
            scopes: ['.'],
            includedBy: [],
        }]);
        expect(result.instructions?.complete).toBe(true);
    });

    it('returns null instructions for a workspace without a repository', async () => {
        await fixture.write({ 'AGENTS.md': 'not a repository checkout\n' });

        const result = await callTool<WorkspaceResult>(manager.tools(), 'create_workspace', {}, toolContext('r1'));

        expect(result.instructions).toBeNull();
    });

    it('refreshes root guidance when create_workspace reuses a workspace', async () => {
        await fixture.write({ 'AGENTS.md': 'first\n' });

        const tools = manager.tools();
        const first = await callTool<WorkspaceResult>(tools, 'create_workspace', { repo: 'octo/demo' }, toolContext('r1'));

        await fixture.write({ 'AGENTS.md': 'second\n' });

        const second = await callTool<WorkspaceResult>(tools, 'create_workspace', { repo: 'octo/demo' }, toolContext('r1'));

        expect(first.instructions?.sources[0]?.content).toBe('first\n');
        expect(second.reused).toBe(true);
        expect(second.instructions?.sources[0]?.content).toBe('second\n');
    });

    it('collects current guidance from a workspace adopted through find', async () => {
        fixture.workspace.info.repo = 'https://github.com/octo/demo.git';
        fixture.workspace.info.commit = 'b'.repeat(40);
        await fixture.write({ 'AGENTS.md': 'guidance from the adopted checkout\n' });
        provider.create = async () => {
            throw new SandboxError('adoption must not create a workspace');
        };
        provider.find = async () => [fixture.workspace];

        const result = await callTool<WorkspaceResult>(manager.tools(), 'create_workspace', { repo: 'octo/demo' }, toolContext('r1'));

        expect(result.reused).toBe(true);
        expect(result.instructions?.commit).toBe('b'.repeat(40));
        expect(result.instructions?.sources[0]?.content).toBe('guidance from the adopted checkout\n');
    });

    it('cancels explicit collection without disposing the acquired workspace', async () => {
        await manager.acquire('r1', { repo: 'octo/demo' });

        const controller = new AbortController();

        controller.abort();

        await expect(callTool(manager.tools(), 'read_repository_instructions', { workspace: fixture.workspace.id }, toolContext('r1', controller.signal))).rejects.toThrow(SandboxError);

        expect(fixture.workspace.disposed).toBe(false);
        expect(await manager.get('r1', fixture.workspace.id)).toBe(fixture.workspace);
    });

    it('collects only requested ancestor scopes through the explicit tool', async () => {
        await fixture.write({
            'AGENTS.md': 'root\n',
            'src/AGENTS.md': 'source rules\n',
            'src/a.ts': 'export {};\n',
            'other/AGENTS.md': 'unrelated\n',
        });
        await manager.acquire('r1', { repo: 'octo/demo' });

        const result = await callTool<RepositoryInstructions>(manager.tools(), 'read_repository_instructions', {
            paths: ['src/a.ts'],
            workspace: fixture.workspace.id,
        }, toolContext('r1'));

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'src/AGENTS.md']);
        expect(result.paths).toEqual(['src/a.ts']);
        await expect(callTool(manager.tools(), 'read_repository_instructions', { workspace: fixture.workspace.id }, toolContext('r2'))).rejects.toThrow(SandboxError);
    });

    it('defaults explicit collection to the root and only workspace', async () => {
        await fixture.write({ 'AGENTS.md': 'root\n', 'src/AGENTS.md': 'nested\n' });
        await manager.acquire('r1', { repo: 'octo/demo' });

        const result = await callTool<RepositoryInstructions>(manager.tools(), 'read_repository_instructions', {}, toolContext('r1'));

        expect(result.paths).toEqual(['.']);
        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md']);
    });

    it('rejects invalid explicit tool inputs', async () => {
        await manager.acquire('r1', { repo: 'octo/demo' });

        for (const input of [null, { workspace: 42 }, { paths: 'src' }, { paths: [42] }]) {
            await expect(callTool(manager.tools(), 'read_repository_instructions', input, toolContext('r1')))
                .rejects.toThrow(ValidationError);
        }
    });

    it('redacts issued credentials from instructions, diagnostics and workspace metadata', async () => {
        const token = 'issued_credential_12345';
        const content = `Keep ${token} private.\n@missing-${token}.md\n`;

        await manager.close();
        manager = createWorkspaceManager({
            provider,
            gcIntervalMs: 0,
            credentials: staticGitCredentials([{ host: 'github.com', token }]),
        });
        fixture.workspace.info.defaultBranch = token;
        await fixture.write({ 'AGENTS.md': content });

        const result = await callTool<WorkspaceResult>(manager.tools(), 'create_workspace', { repo: 'octo/demo' }, toolContext('r1'));
        const explicit = await callTool<RepositoryInstructions>(manager.tools(), 'read_repository_instructions', {}, toolContext('r1'));

        expect(result).toMatchObject({ defaultBranch: '[redacted]' });
        expect(result.instructions?.sources[0]).toMatchObject({
            content: 'Keep [redacted] private.\n@missing-[redacted].md\n',
            sha256: createHash('sha256').update(content).digest('hex'),
        });
        expect(result.instructions?.diagnostics).toHaveLength(1);
        expect(JSON.stringify([result, explicit])).not.toContain(token);
    });

    it('can disable automatic delivery and the explicit instruction tool', async () => {
        await manager.close();
        manager = createWorkspaceManager({
            provider,
            gcIntervalMs: 0,
            repositoryInstructions: false,
        });
        await fixture.write({ 'AGENTS.md': 'guidance\n' });

        const tools = manager.tools();
        const result = await callTool<WorkspaceResult>(tools, 'create_workspace', { repo: 'octo/demo' }, toolContext('r1'));

        expect(result.instructions).toBeNull();
        expect(tools).not.toHaveProperty('read_repository_instructions');
        expect(result).toMatchObject({
            workspace: fixture.workspace.id,
            root: '/workspace',
            repo: 'https://github.com/octo/demo.git',
            commit: 'a'.repeat(40),
            expiresAt: fixture.workspace.info.expiresAt.toISOString(),
            reused: false,
        });
    });

    it('rejects a nonboolean instruction-delivery option', () => {
        expect(() => createWorkspaceManager({
            provider,
            repositoryInstructions: 'false',
        } as unknown as WorkspaceManagerOptions)).toThrow(InvalidAgentDefinitionError);
    });

    it('keeps an acquired workspace when instruction inspection fails', async () => {
        const { exec } = fixture.workspace;

        fixture.workspace.exec = async () => {
            throw new SandboxError('inspection transport failed');
        };

        await expect(callTool(manager.tools(), 'create_workspace', { repo: 'octo/demo' }, toolContext('r1'))).rejects.toThrow('inspection transport failed');

        fixture.workspace.exec = exec;
        expect(fixture.workspace.disposed).toBe(false);
        expect(await manager.get('r1', fixture.workspace.id)).toBe(fixture.workspace);
    });
});
