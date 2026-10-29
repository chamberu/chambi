/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { BigIntStats } from 'node:fs';

import type { SkillMetadata } from '@chamvi/core';

export type ApprovedSkill = {
    name: string;
    version: string;
    directory: string;
    sha256: string;
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
