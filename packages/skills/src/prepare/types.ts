/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type PreparedSkill = {
    readonly name: string;
    readonly description: string;
    readonly path: string;
};

export type PrepareSkillsOptions = {
    signal?: AbortSignal;
    source: string;
    revision: string;
    names: readonly string[];
    directory: string;
    verify?: (skill: PreparedSkill) => void | Promise<void>;
};
