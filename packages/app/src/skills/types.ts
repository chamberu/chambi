/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import type { BigIntStats } from 'node:fs';

export type ApprovedSkill = {
    name: string;
    version: string;
    directory: string;
    sha256: string;
};

export type SkillMetadata = {
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly sha256: string;
    readonly ignoredFields: readonly string[];
};

export type SkillCatalog = {
    readonly skills: readonly SkillMetadata[];
    readonly instructions: string;
    readonly tools: ToolSet;
};

export type LoadedSkill = {
    name: string;
    version: string;
    sha256: string;
    reference: string | null;
    content: string;
    references: string[];
};

/** Internal snapshot; the supporting content map stays inside its reader closure. */
export type SkillBundle = {
    readonly metadata: SkillMetadata;
    readonly body: string;
    readonly references: readonly string[];
    readonly readReference: (path: string) => string | undefined;
};

export type SkillBundleInventory = Map<string, BigIntStats>;

export type ParsedSkillDocument = {
    name: string;
    description: string;
    ignoredFields: readonly string[];
    body: string;
};

export type SkillInput = {
    name: string;
    reference?: string;
};
