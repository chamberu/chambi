/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs';
import { join } from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { ValidationError } from '@chamvi/core';
import type { LoadedSkill, SkillCatalog } from '@chamvi/skills';
import * as app from '@chamvi/skills';
import { approvedSkill, cleanupSkills } from '../../utils/skills.ts';

function load(catalog: SkillCatalog, input: unknown) {
    return catalog.tools.load_skill!.execute!(input as never, {
        context: undefined,
        toolCallId: 'load',
        messages: [],
    }) as Promise<LoadedSkill>;
}

afterEach(cleanupSkills);

describe('load_skill', () => {
    it('loads_body_and_reference_only_on_request', async () => {
        const approved = approvedSkill('audit', { files: { 'z.txt': 'last', 'references/README.md': 'PRIVATE-REFERENCE' } });
        const catalog = app.loadSkillBundles([approved]);

        fs.rmSync(approved.directory, { recursive: true });

        const reference = await load(catalog, { name: 'audit', reference: 'references/README.md' });

        expect(reference).toEqual({
            name: 'audit',
            version: '1.0.0',
            hash: approved.hash,
            reference: 'references/README.md',
            content: 'PRIVATE-REFERENCE',
            references: ['references/README.md', 'z.txt'],
        });

        const body = await load(catalog, { name: 'audit' });

        expect(body).toEqual({
            name: 'audit',
            version: '1.0.0',
            hash: approved.hash,
            reference: null,
            content: 'PRIVATE-BODY\n',
            references: ['references/README.md', 'z.txt'],
        });
        expect(JSON.stringify(body)).not.toContain('PRIVATE-REFERENCE');
        expect(JSON.stringify(reference)).not.toContain('PRIVATE-BODY');
    });

    it.each([
        '../outside.txt',
        '/etc/passwd',
        'a/../ref.txt',
        './ref.txt',
        'a//ref.txt',
        'a/./ref.txt',
        'ref.txt/',
        'a\\ref.txt',
        'ref\0.txt',
        '',
        'SKILL.md',
        'unknown.txt',
    ])('rejects_traversal_and_unapproved_reference %j', async (reference) => {
        const approved = approvedSkill('audit', { files: { 'ref.txt': 'PRIVATE-REFERENCE' } });
        const catalog = app.loadSkillBundles([approved]);

        await expect(load(catalog, { name: 'audit', reference })).rejects.toBeInstanceOf(ValidationError);
    });

    it.each([
        null,
        [],
        'audit',
        {},
        { name: 1 },
        { name: 'unknown' },
        { name: '__proto__' },
        { name: 'constructor' },
        { name: 'audit', reference: null },
        { name: 'audit', reference: 1 },
        { name: 'audit', directory: '/private/secret' },
    ].map((input) => [input]))('validates_direct_runtime_input %j', async (input) => {
        const catalog = app.loadSkillBundles([approvedSkill()]);

        await expect(load(catalog, input)).rejects.toBeInstanceOf(ValidationError);
    });

    it('errors_do_not_echo_secret_source_content_or_host_paths', async () => {
        const approved = approvedSkill('audit', { files: { 'ref.txt': 'PRIVATE-REFERENCE' } });
        const catalog = app.loadSkillBundles([approved]);

        for (const input of [
            { name: approved.directory },
            { name: 'PRIVATE-BODY' },
            { name: 'audit', reference: join(approved.directory, 'ref.txt') },
        ]) {
            try {
                await load(catalog, input);
                expect.unreachable('invalid input was accepted');
            } catch (error) {
                expect(error).toBeInstanceOf(ValidationError);
                expect((error as Error).message).not.toContain(approved.directory);
                expect((error as Error).message).not.toContain('PRIVATE-BODY');
                expect((error as Error).message).not.toContain('PRIVATE-REFERENCE');
            }
        }
    });

    it('repeat_and_parallel_loads_are_identical', async () => {
        const catalog = app.loadSkillBundles([approvedSkill('audit', { files: { 'empty.txt': '' } })]);
        const first = await load(catalog, { name: 'audit' });
        const expected = { ...first, references: ['empty.txt'] };

        first.references.push('unapproved.txt');
        first.content = 'changed';

        const results = await Promise.all(Array.from({ length: 5 }, () => load(catalog, { name: 'audit' })));

        for (const result of results) {
            expect(result).toEqual(expected);
        }

        expect(results[0]!.references).not.toBe(results[1]!.references);
        expect(await load(catalog, { name: 'audit', reference: 'empty.txt' })).toMatchObject({ content: '' });
    });

    it('frontmatter_does_not_create_tools_or_change_model', async () => {
        const catalog = app.loadSkillBundles([approvedSkill('audit', { frontmatter: 'allowed-tools: [shell]\nmodel: hostile/model\n' })]);

        expect(Object.keys(catalog.tools)).toEqual(['load_skill']);
        expect(catalog.skills[0]!.ignoredFields).toEqual(['allowed-tools', 'model']);
        expect(catalog).not.toHaveProperty('model');
        expect(catalog.tools.load_skill).not.toHaveProperty('needsApproval');
        expect(catalog.tools.load_skill).toHaveProperty('contextSchema');
        expect(await load(catalog, { name: 'audit' })).toMatchObject({ content: 'PRIVATE-BODY\n' });
    });

    it('catalogs_are_agent_local', async () => {
        const one = app.loadSkillBundles([approvedSkill('audit', { body: 'first agent' })]);
        const two = app.loadSkillBundles([approvedSkill('audit', { body: 'second agent' }), approvedSkill('other')]);

        expect(await load(one, { name: 'audit' })).toMatchObject({ content: 'first agent' });
        expect(await load(two, { name: 'audit' })).toMatchObject({ content: 'second agent' });
        await expect(load(one, { name: 'other' })).rejects.toBeInstanceOf(ValidationError);
    });
});
