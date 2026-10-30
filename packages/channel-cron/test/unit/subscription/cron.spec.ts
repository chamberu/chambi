/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { cron, cronChannel } from '@chamvi/channel-cron';

describe('cron.on', () => {
    it('rejects an invalid expression', () => {
        expect(() => cron.on('not a cron')).toThrow(InvalidAgentDefinitionError);
        expect(() => cron.on('not a cron')).toThrow(/Invalid cron expression "not a cron"/);
    });

    it('rejects an invalid timezone', () => {
        expect(() => cron.on('0 9 * * *', { timezone: 'Mars/Base' })).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects an unknown overlap policy and an empty id', () => {
        expect(() => cron.on('* * * * *', { overlap: 'sometimes' as never })).toThrow(InvalidAgentDefinitionError);
        expect(() => cron.on('* * * * *', { id: '' })).toThrow(InvalidAgentDefinitionError);
    });

    it('defaults overlap to skip', () => {
        expect(cron.on('*/5 * * * *').options.overlap).toBe('skip');
    });

    it('subscribes to the cron channel with a stable id', () => {
        const s = cron.on('*/5 * * * *');

        expect(s.channel).toBe('cron');
        expect(s.id).toBe('cron:*/5 * * * *');
        expect(s.options.expression).toBe('*/5 * * * *');
    });

    it('takes an id', () => {
        expect(cron.on('*/5 * * * *', { id: 'sweep' }).id).toBe('sweep');
    });

    it('keeps timezone, overlap and payload', () => {
        const s = cron.on('0 * * * *', {
            timezone: 'Europe/Berlin',
            overlap: 'allow',
            payload: { a: 1 },
        });

        expect(s.options).toMatchObject({
            timezone: 'Europe/Berlin',
            overlap: 'allow',
            payload: { a: 1 },
        });
    });

    it('cronChannel().on() subscribes to that channel', () => {
        const s = cronChannel({ name: 'cron-eu' }).on('0 9 * * *', { timezone: 'Europe/Berlin' });

        expect(s.channel).toBe('cron-eu');
        expect(s.id).toBe('cron:0 9 * * *');
        expect(() => cronChannel({ name: 'cron-eu' }).on('nope')).toThrow(InvalidAgentDefinitionError);
    });
});
