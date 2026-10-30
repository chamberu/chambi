/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { expect, it, vi } from 'vitest';

it('imports the main runtime without installation or filesystem writes', async () => {
    const mkdir = vi.spyOn(fs, 'mkdir');
    const mkdtemp = vi.spyOn(fs, 'mkdtemp');
    const writeFile = vi.spyOn(fs, 'writeFile');
    const execFile = vi.spyOn(childProcess, 'execFile');
    const spawn = vi.spyOn(childProcess, 'spawn');
    try {
        await import('@chamvi/skills');
        for (const operation of [mkdir, mkdtemp, writeFile, execFile, spawn]) {
            expect(operation).not.toHaveBeenCalled();
        }
    } finally {
        vi.restoreAllMocks();
    }
});
