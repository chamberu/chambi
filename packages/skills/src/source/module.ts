/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ISkillSource, Skill } from '@chamvi/core';
import { loadSkillBundle } from '../bundle/module.ts';
import { validateApprovedSkill } from '../bundle/helpers.ts';
import { SKILL_MAX_BUNDLES } from '../bundle/constants.ts';
import { prepareSkills } from '../prepare/module.ts';
import { copyPreparationOptions, invalid } from '../prepare/helpers.ts';
import type { GitSkillsOptions } from './types.ts';

/** Describe reviewed Git content without filesystem or network access. */
export function gitSkills(options: GitSkillsOptions): ISkillSource {
    if (!options || !Array.isArray(options.approved)) {
        invalid();
    }

    if (options.approved.length > SKILL_MAX_BUNDLES) {
        invalid();
    }

    const approved = Object.freeze(options.approved.map((pin) => {
        validateApprovedSkill({ ...pin, directory: '/' });
        if (!pin.version.isWellFormed()) {
            invalid();
        }

        return Object.freeze({
            name: pin.name,
            version: pin.version,
            hash: pin.hash,
        });
    }));
    const configuration = copyPreparationOptions({ ...options, names: approved.map((pin) => pin.name) });
    const {
        source,
        revision,
        requestedDirectory: directory,
        names,
    } = configuration;
    return Object.freeze({
        skills: approved,
        async load({ signal }: { signal: AbortSignal }): Promise<readonly Skill[]> {
            const snapshots: Skill[] = [];
            await prepareSkills({
                source,
                revision,
                directory,
                names,
                signal,
                verify: (staged) => {
                    const pin = approved.find((entry) => entry.name === staged.name)!;
                    snapshots.push(loadSkillBundle({ ...pin, directory: staged.path }));
                },
            });
            signal.throwIfAborted();
            return Object.freeze(snapshots);
        },
    });
}
