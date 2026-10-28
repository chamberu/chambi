/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs';
import { join } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as app from '@chamvi/app';
import { approvedSkill, cleanupSkills } from '../../utils/skills.ts';

afterEach(() => {
    vi.restoreAllMocks();
    cleanupSkills();
});

describe('approved skill catalog', () => {
    it('renders_only_metadata_in_name_order', () => {
        const zulu = approvedSkill('zulu', { files: { 'ref.txt': 'PRIVATE-REFERENCE' } });
        const alpha = approvedSkill('alpha', { description: 'Review "quoted" code \u2028 safely' });
        const catalog = app.loadSkillBundles([zulu, alpha]);
        expect(catalog.skills.map((entry) => entry.name)).toEqual(['alpha', 'zulu']);
        for (const approved of [alpha, zulu]) {
            expect(catalog.instructions).toContain(JSON.stringify(approved.name));
            expect(catalog.instructions).toContain(approved.version);
            expect(catalog.instructions).toContain(approved.sha256);
            expect(catalog.instructions).not.toContain(approved.directory);
        }
        expect(catalog.instructions.indexOf('"alpha"')).toBeLessThan(catalog.instructions.indexOf('"zulu"'));
        expect(catalog.instructions).toContain(JSON.stringify(alpha.name));
        expect(catalog.instructions).toContain(String.raw`Review \"quoted\" code`);
        expect(catalog.instructions).toContain('load_skill');
        expect(catalog.instructions).not.toContain('PRIVATE-BODY');
        expect(catalog.instructions).not.toContain('PRIVATE-REFERENCE');
        expect(catalog.instructions).not.toContain('ref.txt');
        expect(app.loadSkillBundles([alpha, zulu]).instructions).toBe(catalog.instructions);
    });

    it('rejects_duplicate_names_and_over_limit_catalog', () => {
        const approved = approvedSkill();
        expect(() => app.loadSkillBundles([approved, approved])).toThrow(InvalidAgentDefinitionError);
        expect(() => app.loadSkillBundles(Array.from({ length: 17 }, (_, index) => ({ ...approved, name: `skill-${index}` }))))
            .toThrow(InvalidAgentDefinitionError);
        const sixteen = Array.from({ length: 16 }, (_, index) => approvedSkill(`skill-${index}`));
        expect(app.loadSkillBundles(sixteen).skills).toHaveLength(16);
    });

    it('empty_catalog_has_no_tools', () => {
        expect(app.loadSkillBundles([])).toEqual({
            skills: [],
            instructions: '',
            tools: {},
        });
    });

    it('failed_bundle_prevents_partial_catalog', () => {
        const good = approvedSkill();
        const invalid = approvedSkill('other');
        fs.appendFileSync(join(invalid.directory, 'SKILL.md'), 'PRIVATE-CHANGED');
        let result: app.SkillCatalog | undefined;
        expect(() => { result = app.loadSkillBundles([good, invalid]); }).toThrow(InvalidAgentDefinitionError);
        expect(result).toBeUndefined();
        try {
            app.loadSkillBundles([good, invalid]);
        } catch (error) {
            expect((error as Error).message).not.toContain(invalid.directory);
            expect((error as Error).message).not.toContain('PRIVATE-CHANGED');
        }
    });

    it('caller_cannot_mutate_snapshot', () => {
        const approved = approvedSkill('audit', { frontmatter: 'model: secret/model\n' });
        const entries = [approved];
        const catalog = app.loadSkillBundles(entries);
        entries.length = 0;
        approved.name = 'changed';
        approved.version = 'changed';
        expect(catalog.skills[0]).toMatchObject({
            name: 'audit',
            version: '1.0.0',
            ignoredFields: ['model'],
        });
        expect(Object.isFrozen(catalog)).toBe(true);
        expect(Object.isFrozen(catalog.skills)).toBe(true);
        expect(Object.isFrozen(catalog.skills[0])).toBe(true);
        expect(Object.isFrozen(catalog.skills[0]!.ignoredFields)).toBe(true);
        expect(Object.isFrozen(catalog.tools)).toBe(true);
        expect(Object.isFrozen(catalog.tools.load_skill)).toBe(true);
    });

    it('importing_the_root_does_not_scan_bundles', async () => {
        vi.resetModules();
        const scan = vi.spyOn(fs, 'opendirSync');
        await import('@chamvi/app');
        expect(scan).not.toHaveBeenCalled();
    });
});
