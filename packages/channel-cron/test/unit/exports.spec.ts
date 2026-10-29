/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as channelCron from '@chamvi/channel-cron';

describe('public api', () => {
    it.each([
        'assertSchedulable',
        'createRepositoryScheduleLock',
        'cronChannel',
        'fireCronSubscription',
        'readCronOptions',
        'runJob',
    ])('exports %s', (name) => {
        expect(channelCron).toHaveProperty(name);
        expect(channelCron[name as keyof typeof channelCron]).toBeTypeOf('function');
    });

    it('exports the cron builder', () => {
        expect(channelCron.cron.on).toBeTypeOf('function');
    });

    it('exports the constants', () => {
        expect(channelCron.CRON_CHANNEL_NAME).toBe('cron');
        expect(channelCron.SCHEDULE_LOCK_TTL_MS).toBe(600_000);
    });

    it('keeps the scheduler internal', () => {
        expect(channelCron).not.toHaveProperty('createScheduler');
        expect(channelCron).not.toHaveProperty('fireCronTrigger');
    });
});
