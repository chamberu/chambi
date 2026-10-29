/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { SkillIdentity } from '@chamvi/core';

export type GitSkillsOptions = {
    source: string;
    revision: string;
    directory: string;
    approved: readonly SkillIdentity[];
};
