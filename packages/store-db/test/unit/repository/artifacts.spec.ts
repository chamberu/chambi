/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import {
    afterAll,
    beforeAll,
    beforeEach,
    expect,
    it,
} from 'vitest';
import type { Artifact } from '@chamvi/core';
import { DatabaseArtifactRepository } from '@chamvi/store-db';
import { ArtifactEntity } from '../../../src/entities/index.ts';
import { createTestDataSource, describePostgres, truncateRepository } from '../../utils/database.ts';

const artifact = (id: string, overrides: Partial<Artifact> = {}): Artifact => ({
    id,
    runId: 'r1',
    agent: 'a',
    mediaType: 'application/octet-stream',
    filename: `${id}.bin`,
    size: 3,
    createdAt: new Date(1_000),
    ...overrides,
});

describePostgres('DatabaseArtifactRepository artifacts', () => {
    let dataSource: DataSource;
    let store: DatabaseArtifactRepository;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    beforeEach(async () => {
        await truncateRepository(dataSource);
        store = new DatabaseArtifactRepository({ dataSource });
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('repositories the bytes as bytea and never loads them with the metadata', async () => {
        await store.insert(artifact('a1'), new Uint8Array([0, 1, 255]));

        const [{ type }] = await dataSource.query(
            'SELECT pg_typeof(data)::text AS type FROM chamvi_artifacts WHERE id = $1',
            ['a1'],
        );
        expect(type).toBe('bytea');

        const entity = await dataSource.getRepository(ArtifactEntity).findOneBy({ id: 'a1' });
        expect(entity).not.toBeNull();
        expect(entity!.data).toBeUndefined();
    });

    it('reads bytes as a plain Uint8Array that serializes like one', async () => {
        await store.insert(artifact('a1'), new Uint8Array([7, 8, 9]));
        const bytes = await store.read('a1');
        expect(bytes?.constructor).toBe(Uint8Array);
        expect(JSON.stringify(bytes)).toBe(JSON.stringify(new Uint8Array([7, 8, 9])));
    });

    it('repositories a Buffer view and a subarray by their own bytes only', async () => {
        const backing = new Uint8Array([1, 2, 3, 4, 5]);
        await store.insert(artifact('a1', { size: 2 }), backing.subarray(1, 3));
        expect(Array.from((await store.read('a1'))!)).toEqual([2, 3]);

        await store.insert(artifact('a2'), Buffer.from([4, 5, 6]));
        expect(Array.from((await store.read('a2'))!)).toEqual([4, 5, 6]);
    });
});
