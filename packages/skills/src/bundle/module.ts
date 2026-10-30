/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createSkillCatalog } from '../catalog/module.ts';
import type { SkillInput } from '@chamvi/core';
import { defineSkill } from '../runtime/adapters.ts';
import type { Skill, SkillCatalog } from '../catalog/types.ts';
import { readSkillBundle } from './bundle.ts';
import { SKILL_MAX_BUNDLES } from './constants.ts';
import { invalidSkill, validateApprovedSkill } from './helpers.ts';
import type { ApprovedSkill } from './types.ts';

/** Explicitly verify a filesystem bundle and detach all content from its reader. */
export function loadSkillBundle(approved: ApprovedSkill): Skill & SkillInput {
    validateApprovedSkill(approved);

    const bundle = readSkillBundle(approved);

    return defineSkill({
        ...bundle.metadata,
        body: bundle.body,
        references: Object.freeze(Object.fromEntries(bundle.references.map((path) => [path, bundle.readReference(path)!]))),
    });
}

/** Verify explicitly approved bundles once and keep their immutable snapshots local to this catalog. */
export function loadSkillBundles(approved: readonly ApprovedSkill[]): SkillCatalog {
    if (!Array.isArray(approved) || approved.length > SKILL_MAX_BUNDLES) {
        invalidSkill('.', 'catalog must be an array of at most 16 approved bundles');
    }

    const names = new Set<string>();

    for (const descriptor of approved) {
        validateApprovedSkill(descriptor);

        if (names.has(descriptor.name)) {
            invalidSkill('.', 'duplicate approved skill name');
        }

        names.add(descriptor.name);
    }

    return createSkillCatalog(approved.map(loadSkillBundle));
}
