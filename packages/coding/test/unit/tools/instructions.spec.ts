/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { codingTools } from '@chamvi/coding';
import type { CodingToolsOptions, ReadFileResult } from '@chamvi/coding';
import { InvalidAgentDefinitionError, SandboxError, ValidationError } from '@chamvi/core';
import type { GitFixture } from '@chamvi/test-kit';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

describe('repository instructions on read_file', () => {
    let fixture: GitFixture;
    let setup: CodingSetup;

    beforeAll(async () => {
        fixture = await createFixture();
    });
    afterAll(async () => {
        await fixture.cleanup();
    });
    beforeEach(async () => {
        setup = await setupCoding(fixture);
    });
    afterEach(async () => {
        await setup.cleanup();
    });

    it('delivers root and ancestor guidance beside the unchanged file text', async () => {
        await setup.workspace.writeFile('AGENTS.md', 'root guidance\n');
        await setup.workspace.writeFile('src/CLAUDE.md', 'source guidance\n');
        await setup.workspace.writeFile('elsewhere/AGENTS.md', 'unrelated guidance\n');

        const result = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts' });

        expect(result.content).toBe('export const a = 1;\nexport const b = 2;');
        expect(result.instructions?.paths).toEqual(['src/a.ts']);
        expect(result.instructions?.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'src/CLAUDE.md']);
        expect(result.instructions?.sources).toEqual([
            {
                path: 'AGENTS.md',
                content: 'root guidance\n',
                sha256: createHash('sha256').update('root guidance\n').digest('hex'),
                scopes: ['.'],
                includedBy: [],
            },
            {
                path: 'src/CLAUDE.md',
                content: 'source guidance\n',
                sha256: createHash('sha256').update('source guidance\n').digest('hex'),
                scopes: ['src'],
                includedBy: [],
            },
        ]);
    });

    it('refreshes guidance after the workspace instruction file changes', async () => {
        await setup.workspace.writeFile('AGENTS.md', 'first\n');

        const first = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts' });

        await setup.workspace.writeFile('AGENTS.md', 'second\n');

        const second = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts' });

        expect(first.instructions?.sources[0]?.content).toBe('first\n');
        expect(second.instructions?.sources[0]?.content).toBe('second\n');
        expect(second.instructions?.sources[0]?.sha256).not.toBe(first.instructions?.sources[0]?.sha256);
    });

    it('keeps two workspaces of the same run isolated', async () => {
        const secondFixture = await createFixture();

        try {
            const { workspace: second } = await setup.manager.acquire('r1', { repo: secondFixture.url });

            await setup.workspace.writeFile('AGENTS.md', 'first workspace\n');
            await setup.workspace.writeFile('src/AGENTS.md', 'first subtree\n');
            await second.writeFile('AGENTS.md', 'second workspace\n');
            await second.writeFile('src/CLAUDE.md', 'second subtree\n');

            const firstRead = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts', workspace: setup.workspace.id });
            const secondRead = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts', workspace: second.id });
            const firstAgain = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts', workspace: setup.workspace.id });

            expect(firstRead.instructions?.sources.map(({ path, sha256 }) => ({ path, sha256 }))).toEqual([
                { path: 'AGENTS.md', sha256: createHash('sha256').update('first workspace\n').digest('hex') },
                { path: 'src/AGENTS.md', sha256: createHash('sha256').update('first subtree\n').digest('hex') },
            ]);
            expect(secondRead.instructions?.sources.map(({ path, sha256 }) => ({ path, sha256 }))).toEqual([
                { path: 'AGENTS.md', sha256: createHash('sha256').update('second workspace\n').digest('hex') },
                { path: 'src/CLAUDE.md', sha256: createHash('sha256').update('second subtree\n').digest('hex') },
            ]);
            expect(firstAgain.instructions).toEqual(firstRead.instructions);
            await expect(setup.call('read_file', { path: 'src/a.ts' })).rejects.toThrow(ValidationError);
        } finally {
            await secondFixture.cleanup();
        }
    });

    it('can disable automatic instruction context without changing the file read', async () => {
        await setup.cleanup();
        setup = await setupCoding(fixture, { repositoryInstructions: false });
        await setup.workspace.writeFile('AGENTS.md', 'root guidance\n');

        const result = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts' });

        expect(result).not.toHaveProperty('instructions');
        expect(result.content).toBe('export const a = 1;\nexport const b = 2;');
    });

    it('rejects a nonboolean instruction-delivery option', () => {
        expect(() => codingTools(setup.manager, { repositoryInstructions: 'false' } as unknown as CodingToolsOptions)).toThrow(InvalidAgentDefinitionError);
    });

    it('propagates cancellation to repository instruction collection', async () => {
        const controller = new AbortController();

        controller.abort();

        await expect(setup.call('read_file', { path: 'src/a.ts' }, undefined, controller.signal)).rejects.toThrow(SandboxError);
    });

    it('degrades to null instructions with a diagnostic when collection fails, keeping the file read', async () => {
        const { exec } = setup.workspace;

        setup.workspace.exec = async () => {
            throw new SandboxError('inspection transport failed');
        };

        try {
            const result = await setup.call<ReadFileResult>('read_file', { path: 'src/a.ts' });

            expect(result.content).toBe('export const a = 1;\nexport const b = 2;');
            expect(result.instructions).toBeNull();
            expect(result.instructionsError).toContain('inspection transport failed');
        } finally {
            setup.workspace.exec = exec;
        }
    });

    it('skips the collector in a workspace without a repository', async () => {
        const { workspace } = await setup.manager.acquire('r2', {});

        await workspace.writeFile('AGENTS.md', 'not a checkout\n');
        await workspace.writeFile('notes.txt', 'hello\n');

        const calls: unknown[] = [];
        const { exec } = workspace;

        workspace.exec = async (...args) => {
            calls.push(args[0]);

            return exec.apply(workspace, args);
        };

        const result = await setup.call<ReadFileResult>('read_file', { path: 'notes.txt' }, 'r2');

        expect(result.content).toBe('hello');
        expect(result).not.toHaveProperty('instructions');
        expect(calls).toEqual([]);
    });

    it('leaves image results free of instruction context', async () => {
        await setup.workspace.writeFile('AGENTS.md', 'root guidance\n');
        await setup.workspace.writeFile('image.png', new Uint8Array([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
        ]));

        const result = await setup.call('read_file', { path: 'image.png' });

        expect(result).not.toHaveProperty('instructions');
        expect(result).toMatchObject({ type: 'image', mediaType: 'image/png' });
    });

    it('still rejects a missing text file', async () => {
        await setup.workspace.writeFile('AGENTS.md', 'root guidance\n');

        await expect(setup.call('read_file', { path: 'missing.ts' })).rejects.toThrow(SandboxError);
    });

    it('leaves base64 results free of instruction context', async () => {
        await setup.workspace.writeFile('AGENTS.md', 'root guidance\n');

        const result = await setup.call('read_file', { path: 'src/a.ts', encoding: 'base64' });

        expect(result).not.toHaveProperty('instructions');
        expect(result).toMatchObject({ encoding: 'base64' });
    });
});
