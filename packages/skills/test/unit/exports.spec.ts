/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import type { ISkillSource, Skill } from '@chamvi/core';
import * as skills from '@chamvi/skills';
import type { ApprovedSkill } from '@chamvi/skills';
import { expect, expectTypeOf, it } from 'vitest';

it('exports the Chamvi source, preparation and verified bundle API from main', () => {
    expect(Object.keys(skills).sort()).toEqual(['gitSkills', 'hashSkillBundle', 'loadSkillBundle', 'loadSkillBundles', 'prepareSkills']);
    expectTypeOf<ReturnType<typeof skills.gitSkills>>().toEqualTypeOf<ISkillSource>();
    expectTypeOf<ReturnType<typeof skills.loadSkillBundle>>().toEqualTypeOf<Skill>();
    expectTypeOf<Parameters<typeof skills.loadSkillBundles>[0]>().toEqualTypeOf<readonly ApprovedSkill[]>();
});

it('keeps the optional SDK pin and runtime graph app-free', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies.skills).toBe('git+https://github.com/tada5hi/skills-cli.git#6c80a94543b91a27df7445f40dfea7a61e0a5e9f');
    expect(pkg.dependencies).not.toHaveProperty('@chamvi/app');
    expect(pkg.peerDependencies).not.toHaveProperty('@chamvi/app');
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './package.json']);
});
