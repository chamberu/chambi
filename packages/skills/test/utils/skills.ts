/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ApprovedSkill } from '../../src/bundle/types.ts';
import { hashSkillBundle } from '../../src/bundle/bundle.ts';

const directories: string[] = [];

export function approvedSkill(name = 'audit', options: {
    description?: string;
    body?: string;
    frontmatter?: string;
    files?: Record<string, string>;
} = {}): ApprovedSkill {
    const directory = fs.mkdtempSync(join(tmpdir(), 'chamvi-catalog-'));

    directories.push(directory);

    const metadata = `name: ${name}\ndescription: ${JSON.stringify(options.description ?? 'Review code')}\n${options.frontmatter ?? ''}`;
    const files = {
        'SKILL.md': `---\n${metadata}---\n${options.body ?? 'PRIVATE-BODY\n'}`,
        ...options.files,
    };

    for (const [path, content] of Object.entries(files)) {
        fs.mkdirSync(dirname(join(directory, path)), { recursive: true });
        fs.writeFileSync(join(directory, path), content);
    }

    return {
        name,
        directory,
        version: '1.0.0',
        hash: hashSkillBundle(directory),
    };
}

export function cleanupSkills(): void {
    for (const directory of directories) {
        fs.rmSync(directory, { recursive: true, force: true });
    }

    directories.length = 0;
}
