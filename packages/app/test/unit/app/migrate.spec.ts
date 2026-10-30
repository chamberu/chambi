/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { cron } from '@chamvi/channel-cron';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import { ControllableClock, textModel } from '@chamvi/test-kit';
import { DataSource } from 'typeorm';
import {
    describe,
    expect,
    it,
} from 'vitest';
import { configModule, createApp } from '@chamvi/app';
import { rejectionOf } from '../../utils/app.ts';
import { createTestDatabaseUrl, describePostgres } from '../../utils/database.ts';
import { createRecordingLogger } from '../../utils/logger.ts';

const agent = defineAgent({
    name: 'sweep',
    model: textModel(),
    instructions: 'x',
    channels: [cron.on('*/5 * * * *')],
});

function build() {
    const clock = new ControllableClock();
    return createApp({ agents: [agent], modules: [configModule({ clock, logger: createRecordingLogger(clock) })] });
}

describe('App.migrate', () => {
    it('rejects naming DATABASE_URL without one', async () => {
        const error = await rejectionOf(build().migrate({ env: {} }));

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('DATABASE_URL');
    });
});

describePostgres('App.migrate on Postgres', () => {
    it('migrates and closes', async () => {
        const url = await createTestDatabaseUrl();

        await build().migrate({ env: { DATABASE_URL: url } });

        const check = new DataSource({ type: 'postgres', url });
        await check.initialize();
        try {
            const rows = await check.query('SELECT to_regclass(\'public.chamvi_runs\') AS name') as Array<{ name: string | null }>;
            expect(rows[0]?.name).toBe('chamvi_runs');
            const sessions = await check.query(
                'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()',
            ) as Array<{ n: number }>;
            expect(sessions[0]?.n).toBe(0);
        } finally {
            await check.destroy();
        }
    });
});
