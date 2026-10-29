/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { ErrorCode, InvalidRunStateError } from '@chamvi/core';
import { attachmentIds, createRunArtifacts, storeArtifact } from '../../../src/artifact/module.ts';
import { createMemoryRepositories } from '../../../src/repository/index.ts';
import { ControllableClock } from '../../utils/clock.ts';

const run = { id: 'run-1', agent: 'vision' };
const input = (text: string) => ({
    mediaType: 'text/plain',
    filename: `${text}.txt`,
    data: new TextEncoder().encode(text),
});

describe('storeArtifact', () => {
    it('returns the stored artifact when the run already holds the id', async () => {
        const store = createMemoryRepositories();
        const first = await storeArtifact(store.artifacts, run, input('first'), new Date(1), 'run-1.0000');
        const second = await storeArtifact(store.artifacts, run, input('second!'), new Date(2), 'run-1.0000');
        expect(second).toEqual(first);
        expect(await store.artifacts.find('run-1')).toEqual([first]);
        expect(new TextDecoder().decode(await store.artifacts.read('run-1.0000'))).toBe('first');
    });

    it('throws InvalidRunStateError when another run holds the id', async () => {
        const store = createMemoryRepositories();
        await storeArtifact(store.artifacts, { id: 'run-2', agent: 'vision' }, input('x'), new Date(1), 'taken');
        const promise = storeArtifact(store.artifacts, run, input('y'), new Date(1), 'taken');
        await expect(promise).rejects.toBeInstanceOf(InvalidRunStateError);
        await expect(promise).rejects.toMatchObject({ code: ErrorCode.INVALID_RUN_STATE });
    });

    it('gives tool artifacts random ids', async () => {
        const clock = new ControllableClock(new Date(1));
        const artifacts = createRunArtifacts(createMemoryRepositories({ clock }).artifacts, run, clock);
        const a = await artifacts.put(input('a'));
        const b = await artifacts.put(input('b'));
        expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(b.id).not.toBe(a.id);
    });
});

describe('attachmentIds', () => {
    it('pads the index to at least 4 digits', () => {
        expect(attachmentIds('r', 2)).toEqual(['r.0000', 'r.0001']);
        expect(attachmentIds('r', 0)).toEqual([]);
    });

    it('widens every index of a dispatch when the count needs it', () => {
        const ids = attachmentIds('r', 10_001);
        expect(ids[0]).toBe('r.00000');
        expect(ids.at(-1)).toBe('r.10000');
        expect([...ids].sort()).toEqual(ids);
    });
});
