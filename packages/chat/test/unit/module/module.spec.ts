/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { AppToken } from '@chamvi/app';
import { createModuleHarness } from '@chamvi/app/testing';
import type { ModuleHarness } from '@chamvi/app/testing';
import { chatModule } from '@chamvi/chat/module';
import { createIntakeFixture } from '../../utils/intake.ts';

let harnesses: ModuleHarness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((harness) => harness.stop()));
    harnesses = [];
});

describe('chatModule', () => {
    it('module_has_one_channel_contribution', async () => {
        const fixture = createIntakeFixture({ agents: () => [], patch: { webhooks: ['fake'] } });
        const module = chatModule({ channel: fixture.channel });
        const harness = await createModuleHarness({ modules: [module] });

        harnesses.push(harness);

        expect(module.name).toBe('chamvi:channel:chat');
        expect(harness.container.resolveAll(AppToken.CHANNELS)).toEqual([fixture.channel]);
        expect(harness.container.resolveAll(AppToken.CHANNELS)[0]).toBe(fixture.channel);
        // the webhook path is the channel mount of the http module, never an extra route
        expect(harness.container.resolveAll(AppToken.HTTP_ROUTES)).toEqual([]);
        expect(harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS)).toEqual([]);
        // no start step of its own: the engine starts channels
        expect(fixture.adapter.initializeCalls).toBe(0);
        expect(harness.reported).toEqual([]);
    });

    it('names itself after a named channel, so two channels are two modules', async () => {
        const first = createIntakeFixture({ agents: () => [] });
        const second = createIntakeFixture({ agents: () => [], patch: { name: 'ops' } });
        const harness = await createModuleHarness({ modules: [chatModule({ channel: first.channel }), chatModule({ channel: second.channel })] });

        harnesses.push(harness);

        expect(chatModule({ channel: second.channel }).name).toBe('chamvi:channel:ops');
        expect(harness.container.resolveAll(AppToken.CHANNELS).map((channel) => channel.name)).toEqual(['chat', 'ops']);
    });

    it('refuses anything but a channel of chatChannel()', () => {
        const fixture = createIntakeFixture({ agents: () => [] });

        for (const options of [
            undefined,
            {},
            { channel: undefined },
            { channel: { name: 'chat' } },
            { channel: { ...fixture.channel } },
        ]) {
            expect(() => chatModule(options as never), JSON.stringify(options)).toThrow(InvalidAgentDefinitionError);
        }
    });
});
