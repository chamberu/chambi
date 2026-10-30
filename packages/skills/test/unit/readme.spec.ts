/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs/promises';
import { expect, it } from 'vitest';

it('keeps the typed consumer fixture in the README', async () => {
    const example = await fs.readFile(new URL('../fixtures/readme-example.ts', import.meta.url), 'utf8');
    const readme = await fs.readFile(new URL('../../README.md', import.meta.url), 'utf8');

    expect(readme).toContain(example);
});
