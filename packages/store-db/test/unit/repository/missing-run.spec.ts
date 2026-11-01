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
    describe,
    expect,
    it,
} from 'vitest';
import { TableName } from '../../../src/entities/constants.ts';
import { isMissingRunError, runForeignKeyNames } from '../../../src/repository/helpers.ts';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';

function violation(fields: Record<string, unknown>): Error {
    return Object.assign(new Error('insert or update violates foreign key constraint'), { driverError: { code: '23503', ...fields } });
}

describe('isMissingRunError', () => {
    const constraints = new Set(['FK_runs']);

    it('matches a run foreign key by its constraint name, whatever language the detail is in', () => {
        const error = violation({
            constraint: 'FK_runs',
            detail: 'Schlüssel (run_id)=(x) ist nicht in Tabelle »chamvi_runs« vorhanden.',
        });

        expect(isMissingRunError(error, constraints)).toBe(true);
    });

    it('ignores another constraint even when the detail names the runs table', () => {
        const error = violation({
            constraint: 'FK_scope',
            detail: `Key (run_id)=(x) is not present in table "${TableName.RUNS}".`,
        });

        expect(isMissingRunError(error, constraints)).toBe(false);
    });

    it('ignores another error code and errors without a driver error', () => {
        expect(isMissingRunError(Object.assign(new Error('x'), { driverError: { code: '23505', constraint: 'FK_runs' } }), constraints)).toBe(false);
        expect(isMissingRunError(new Error('x'), constraints)).toBe(false);
        expect(isMissingRunError(undefined, constraints)).toBe(false);
    });
});

describePostgres('runForeignKeyNames', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('names exactly the migrated foreign keys that reference the runs table', async () => {
        const rows: Array<{ conname: string }> = await dataSource.query(
            // pg_constraint has no entity: the catalog is read to compare it with the metadata.
            'SELECT conname FROM pg_constraint WHERE contype = \'f\' AND confrelid = $1::regclass ORDER BY conname',
            [TableName.RUNS],
        );

        expect([...runForeignKeyNames(dataSource)].sort()).toEqual(rows.map((row) => row.conname).sort());
        expect(rows.length).toBeGreaterThan(0);
    });
});
