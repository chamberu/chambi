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
import { readRepositoryInstructions } from '@chamvi/sandbox';
import type { LocalFixture } from '../../utils/instructions.ts';
import { createLocalFixture } from '../../utils/instructions.ts';

const sha256 = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

describe('readRepositoryInstructions (local workspace)', () => {
    let fixture: LocalFixture;

    beforeEach(async () => {
        fixture = await createLocalFixture();
    });

    afterEach(async () => {
        await fixture.dispose();
    });

    it('collects_root_and_ancestor_scopes_in_order', async () => {
        await fixture.write({
            'AGENTS.md': '# root agents\n',
            'CLAUDE.md': '# root claude\n',
            'packages/api/AGENTS.md': '# api agents\n',
            'packages/api/src/a.ts': 'export {};\n',
            'packages/web/AGENTS.md': '# sibling\n',
            'packages/api/src/nested/AGENTS.md': '# below the target\n',
        });

        const result = await readRepositoryInstructions(fixture.workspace, ['packages/api/src/a.ts']);

        expect(result.paths).toEqual(['packages/api/src/a.ts']);
        expect(result.sources.map((source) => source.path)).toEqual([
            'AGENTS.md',
            'CLAUDE.md',
            'packages/api/AGENTS.md',
        ]);
        expect(result.sources[0]).toEqual({
            path: 'AGENTS.md',
            sha256: sha256('# root agents\n'),
            content: '# root agents\n',
            scopes: ['.'],
            includedBy: [],
        });
        expect(result.sources[2]?.scopes).toEqual(['packages/api']);
        expect(result.diagnostics).toEqual([]);
        expect(result.complete).toBe(true);
        expect(result.commit).toBeNull();
    });

    it('defaults to the workspace root and includes an existing directory itself', async () => {
        await fixture.write({
            'AGENTS.md': 'root\n',
            'packages/api/AGENTS.md': 'api\n',
        });

        const root = await readRepositoryInstructions(fixture.workspace);

        expect(root.paths).toEqual(['.']);
        expect(root.sources.map((source) => source.path)).toEqual(['AGENTS.md']);

        const directory = await readRepositoryInstructions(fixture.workspace, ['/workspace/packages/api/']);

        expect(directory.paths).toEqual(['packages/api']);
        expect(directory.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'packages/api/AGENTS.md']);

        const missing = await readRepositoryInstructions(fixture.workspace, ['packages/api/new/file.ts']);

        expect(missing.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'packages/api/AGENTS.md']);
        expect(missing.complete).toBe(true);
    });

    it('expands_standalone_references_once', async () => {
        await fixture.write({
            'CLAUDE.md': '@AGENTS.md\n@.agents/structure.md\n@.agents/architecture.md\n@.agents/testing.md\n@.agents/conventions.md\n',
            'AGENTS.md': '# agents\nSee @.agents/structure.md inline.\n',
            '.agents/structure.md': 'structure\n',
            '.agents/architecture.md': 'architecture\n@./testing.md\n',
            '.agents/testing.md': 'testing\n',
            '.agents/conventions.md': 'conventions\n',
        });

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.sources.map((source) => source.path)).toEqual([
            'AGENTS.md',
            'CLAUDE.md',
            '.agents/structure.md',
            '.agents/architecture.md',
            '.agents/testing.md',
            '.agents/conventions.md',
        ]);

        const byPath = Object.fromEntries(result.sources.map((source) => [source.path, source]));

        expect(byPath['AGENTS.md']?.includedBy).toEqual(['CLAUDE.md']);
        // depth first: architecture.md reaches testing.md before CLAUDE.md's own line does
        expect(byPath['.agents/testing.md']?.includedBy).toEqual(['.agents/architecture.md', 'CLAUDE.md']);
        expect(byPath['.agents/structure.md']?.scopes).toEqual(['.']);
        expect(byPath['CLAUDE.md']?.includedBy).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        expect(result.complete).toBe(true);
    });

    it('ignores_fenced_and_inline_mentions', async () => {
        await fixture.write({
            'AGENTS.md': [
                '````sh',
                '@fenced-backtick.md',
                // shorter: no closing fence
                '```',
                '@still-fenced.md',
                '````',
                '~~~~',
                '@fenced-tilde.md',
                '~~~',
                '```',
                '@still-tilde.md',
                '~~~~~',
                'Mention @inline.md and [a link](linked.md).',
                '@has space.md',
                '  @guide.md  ',
            ].join('\n'),
            'guide.md': 'guide\n',
        });

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'guide.md']);
        expect(result.diagnostics).toEqual([]);
    });

    it('refreshes_modified_sources', async () => {
        await fixture.write({ 'AGENTS.md': 'first\n' });

        const first = await readRepositoryInstructions(fixture.workspace);

        await fixture.write({ 'AGENTS.md': 'second\n' });

        const second = await readRepositoryInstructions(fixture.workspace);

        expect(first.sources[0]?.content).toBe('first\n');
        expect(second.sources[0]?.content).toBe('second\n');
        expect(second.sources[0]?.sha256).toBe(sha256('second\n'));
        expect(second.sources[0]?.sha256).not.toBe(first.sources[0]?.sha256);
    });

    it('records the checkout commit when the workspace knows it', async () => {
        (fixture.workspace.info as { commit?: string }).commit = 'a'.repeat(40);

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.commit).toBe('a'.repeat(40));
    });

    it('preserves descendant scopes when a seen source is reached in a new scope', async () => {
        await fixture.write({
            'AGENTS.md': '@docs/shared.md\n',
            'docs/shared.md': '@docs/leaf.md\n'.replace('docs/', ''),
            'docs/leaf.md': 'leaf\n',
            'packages/api/AGENTS.md': '@../../docs/shared.md\n',
        });

        const result = await readRepositoryInstructions(fixture.workspace, ['packages/api/x.ts']);

        const byPath = Object.fromEntries(result.sources.map((source) => [source.path, source]));

        expect(byPath['docs/shared.md']?.scopes).toEqual(['.', 'packages/api']);
        expect(byPath['docs/leaf.md']?.scopes).toEqual(['.', 'packages/api']);
        expect(byPath['docs/shared.md']?.includedBy).toEqual(['AGENTS.md', 'packages/api/AGENTS.md']);
        expect(result.diagnostics).toEqual([]);
        expect(result.complete).toBe(true);
    });

    it('expands descendants when a source is reached again through a shorter path', async () => {
        await fixture.write({
            'AGENTS.md': '@a1.md\n@shared.md\n',
            'a1.md': '@a2.md\n',
            'a2.md': '@a3.md\n',
            'a3.md': '@a4.md\n',
            'a4.md': '@a5.md\n',
            'a5.md': '@a6.md\n',
            'a6.md': '@a7.md\n',
            'a7.md': '@shared.md\n',
            'shared.md': '@child.md\n',
            'child.md': 'guidance reached through the shorter route\n',
        });

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.sources.filter((source) => source.path === 'shared.md')).toHaveLength(1);
        expect(result.sources.find((source) => source.path === 'shared.md')?.includedBy)
            .toEqual(['a7.md', 'AGENTS.md']);
        expect(result.sources.find((source) => source.path === 'child.md')).toMatchObject({
            content: 'guidance reached through the shorter route\n',
            scopes: ['.'],
            includedBy: ['shared.md'],
        });
    });

    it('reports_cycles_missing_includes_and_invalid_utf8', async () => {
        await fixture.write({
            'AGENTS.md': '@a.md\n@missing.md\n@bad.md\n',
            'a.md': '@b.md\n',
            'b.md': '@a.md\n',
            'bad.md': new Uint8Array([0x68, 0x69, 0xff, 0x0a]),
        });

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'a.md', 'b.md']);
        expect(result.sources.find((source) => source.path === 'a.md')?.includedBy).toEqual(['AGENTS.md', 'b.md']);
        expect(result.diagnostics.map(({ path, code }) => ({ path, code }))).toEqual([
            { path: 'a.md', code: 'cycle' },
            { path: 'missing.md', code: 'missing-include' },
            { path: 'bad.md', code: 'invalid-utf8' },
        ]);
        expect(result.complete).toBe(false);
    });

    it('distinguishes a shared reference from an ancestry cycle', async () => {
        await fixture.write({
            'AGENTS.md': '@b.md\n@c.md\n',
            'b.md': '@d.md\n',
            'c.md': '@d.md\n',
            'd.md': 'd\n',
        });

        const result = await readRepositoryInstructions(fixture.workspace);

        expect(result.diagnostics).toEqual([]);
        expect(result.sources.find((source) => source.path === 'd.md')?.includedBy).toEqual(['b.md', 'c.md']);
    });

    it('does_not_execute_instruction_text', async () => {
        const sentinel = 'chamvi-sentinel';

        await fixture.write({
            'AGENTS.md': [
                `$(touch ${sentinel}-1)`,
                `\`touch ${sentinel}-2\``,
                `@$(touch ${sentinel}-3).md`,
                `@\`touch\${IFS}${sentinel}-4\`.md`,
                `@;touch;${sentinel}-5`,
            ].join('\n'),
        });

        const result = await readRepositoryInstructions(fixture.workspace, [`$(touch ${sentinel}-6)/x`, `;touch ${sentinel}-7`]);

        expect(result.sources[0]?.path).toBe('AGENTS.md');

        const listing = await fixture.workspace.exec(['ls', '-a']);

        expect(listing.stdout).not.toContain(sentinel);
    });

    it('distinguishes_absence_from_transport_failure', async () => {
        const empty = await readRepositoryInstructions(fixture.workspace);

        expect(empty).toEqual({
            commit: null,
            paths: ['.'],
            sources: [],
            diagnostics: [],
            complete: true,
        });

        await fixture.workspace.dispose();
        await expect(readRepositoryInstructions(fixture.workspace)).rejects.toMatchObject({ code: 'sandbox_error' });
    });

    it('propagates cancellation', async () => {
        await fixture.write({ 'AGENTS.md': 'x\n' });

        const controller = new AbortController();

        controller.abort();
        await expect(readRepositoryInstructions(fixture.workspace, undefined, { signal: controller.signal }))
            .rejects.toMatchObject({ code: 'sandbox_error' });
    });

    it('redacts decoded text and outward paths, hashing the original bytes', async () => {
        const secret = 'ghs_secretTOKEN1234';
        const content = `token ${secret}\n@${secret}.md\n`;

        await fixture.write({ 'AGENTS.md': content, [`dir-${secret}/AGENTS.md`]: 'inner\n' });

        const workspace = Object.assign(Object.create(fixture.workspace) as typeof fixture.workspace, { redact: (text: string) => text.split(secret).join('[redacted]') });

        // the prototype copy keeps exec bound to the real workspace
        workspace.exec = fixture.workspace.exec.bind(fixture.workspace);

        const result = await readRepositoryInstructions(workspace, [`dir-${secret}/x.ts`]);

        const serialized = JSON.stringify(result);

        expect(serialized).not.toContain(secret);
        expect(result.sources[0]?.content).toBe('token [redacted]\n@[redacted].md\n');
        expect(result.sources[0]?.sha256).toBe(sha256(content));
        expect(result.paths).toEqual(['dir-[redacted]/x.ts']);
        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'dir-[redacted]/AGENTS.md']);
    });
});
