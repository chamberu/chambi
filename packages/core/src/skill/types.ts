/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';

export type SkillIdentity = Readonly<{
    name: string;
    version: string;
    sha256: string
}>;
export type SkillMetadata = SkillIdentity & Readonly<{ description: string; ignoredFields: readonly string[] }>;
export type Skill = SkillMetadata & Readonly<{ body: string; references: Readonly<Record<string, string>> }>;
export interface ISkillSource {
    readonly skills: readonly SkillIdentity[];
    load(options: { signal: AbortSignal }): Promise<readonly Skill[]>;
}
export type SkillInput = Skill | ISkillSource;
export type SkillCatalog = Readonly<{
    skills: readonly SkillMetadata[];
    instructions: string;
    tools: ToolSet
}>;
export type LoadedSkill = {
    name: string;
    version: string;
    sha256: string;
    reference: string | null;
    content: string;
    references: string[];
};
export type LoadSkillInput = { name: string; reference?: string };
