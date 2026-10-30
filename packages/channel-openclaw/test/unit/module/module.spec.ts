/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { ChannelSendOptions } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { AppToken, ModuleName, configModule } from '@chamvi/app';
import { createModuleHarness } from '@chamvi/app/testing';
import type { ModuleHarness } from '@chamvi/app/testing';
import { openclawModule } from '@chamvi/channel-openclaw/module';
import { createRecordingLogger } from '../../utils/module.ts';
import { createFakeOpenclaw } from '../../utils/openclaw.ts';

const HOOKS_TOKEN = 'hooks-token-value';

function openclawEnv(patch: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
        OPENCLAW_BASE_URL: 'http://openclaw:18789',
        OPENCLAW_HOOKS_TOKEN: HOOKS_TOKEN,
        OPENCLAW_CHANNEL: 'telegram',
        OPENCLAW_TO: '12345',
        ...patch,
    };
}

function sendOptions(clock: ControllableClock): ChannelSendOptions {
    return {
        signal: new AbortController().signal,
        trigger: {
            id: 'e1',
            agent: 'deploy',
            trigger: 'http',
            channel: 'http',
            payload: {},
            receivedAt: clock.now(),
        },
    };
}

let harnesses: ModuleHarness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
});

describe('openclawModule', () => {
    it('is named after the channel and depends on config', () => {
        const module = openclawModule({ env: openclawEnv() });

        expect(module.name).toBe('chamvi:channel:openclaw');
        expect(module.dependencies).toEqual([ModuleName.CONFIG]);
    });

    it.each([
        ['OPENCLAW_BASE_URL'],
        ['OPENCLAW_HOOKS_TOKEN'],
        ['OPENCLAW_CHANNEL'],
        ['OPENCLAW_TO'],
    ])('reads env when called and names a missing %s', (name) => {
        expect(() => openclawModule({ env: openclawEnv({ [name]: '' }) }))
            .toThrow(new InvalidAgentDefinitionError(`${name} is required.`));
    });

    it('a malformed OPENCLAW_BASE_URL names it', () => {
        expect(() => openclawModule({ env: openclawEnv({ OPENCLAW_BASE_URL: 'openclaw' }) }))
            .toThrow('OPENCLAW_BASE_URL must be an absolute URL.');
    });

    it.each([
        ['OPENCLAW_HOOKS_TOKEN', 'tok\n', 'OPENCLAW_HOOKS_TOKEN must not hold control characters'],
        ['OPENCLAW_CHANNEL', 'last', 'OPENCLAW_CHANNEL must name a channel'],
        ['OPENCLAW_HOOKS_PATH', 'hooks', 'OPENCLAW_HOOKS_PATH must start with "/"'],
    ])('a malformed %s throws when called, naming the variable', (name, value, message) => {
        let error: unknown;

        try {
            openclawModule({ env: openclawEnv({ [name]: value }) });
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message.startsWith(message)).toBe(true);
    });

    it('a malformed option keeps the option name', () => {
        expect(() => openclawModule({ env: openclawEnv(), hooksToken: ' padded' }))
            .toThrow('openclawChannel: hooksToken must not hold');
    });

    it('options win over env', () => {
        expect(() => openclawModule({
            env: {},
            baseUrl: 'http://openclaw',
            hooksToken: HOOKS_TOKEN,
            deliver: { channel: 'slack', to: 'ops' },
        })).not.toThrow();
    });

    it('contributes the channel, out only', async () => {
        const harness = await createModuleHarness({
            env: {},
            modules: [configModule({ logger: createRecordingLogger() }), openclawModule({ env: openclawEnv() })],
        });

        harnesses.push(harness);

        const channels = harness.container.resolveAll(AppToken.CHANNELS);

        expect(channels.map((channel) => channel.name)).toEqual(['openclaw']);
        expect(channels[0]!.out).toBeTypeOf('function');
        expect(channels[0]!.in).toBeUndefined();
        expect(harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS)).toEqual([]);
    });

    it('delivers through the gateway with the UI link of CHAMVI_PUBLIC_URL', async () => {
        const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
        const fake = createFakeOpenclaw({
            token: HOOKS_TOKEN,
            hooksPath: '/oc',
            clock,
        });
        const harness = await createModuleHarness({
            env: { CHAMVI_PUBLIC_URL: 'https://chamvi.example' },
            modules: [
                configModule({ clock, logger: createRecordingLogger(clock) }),
                openclawModule({
                    env: openclawEnv({ OPENCLAW_HOOKS_PATH: '/oc', OPENCLAW_ACCOUNT_ID: 'bot' }),
                    fetch: fake.fetch,
                }),
            ],
        });

        harnesses.push(harness);

        const [channel] = harness.container.resolveAll(AppToken.CHANNELS);

        await channel!.out!({
            kind: 'approval',
            key: 'r1:a1',
            runId: 'r1',
            agent: 'deploy',
            title: 'Ship it?',
            body: '',
            approvalId: 'a1',
            expiresAt: new Date('2026-10-22T09:00:00Z'),
        }, '', sendOptions(clock));

        expect(fake.dispatched).toHaveLength(1);

        const [body] = fake.dispatched;

        expect(body).toMatchObject({
            channel: 'telegram',
            to: '12345',
            accountId: 'bot',
        });
        expect(body!.message).toContain('https://chamvi.example/ui/approvals?run=r1&approval=a1');
    });

    it('two names give two modules and two channels', async () => {
        const a = openclawModule({ env: openclawEnv() });
        const b = openclawModule({ env: openclawEnv(), name: 'ops' });

        expect(a.name).toBe('chamvi:channel:openclaw');
        expect(b.name).toBe('chamvi:channel:ops');

        const harness = await createModuleHarness({
            env: {},
            modules: [configModule({ logger: createRecordingLogger() }), a, b],
        });

        harnesses.push(harness);
        expect(harness.container.resolveAll(AppToken.CHANNELS).map((n) => n.name)).toEqual(['openclaw', 'ops']);
    });
});
