/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { setImmediate } from 'node:timers/promises';
import { SandboxError } from '@chamvi/core';
import type { GitCredential, TransportExecResult } from '@chamvi/sandbox';
import { createRemoteWorkspace, readRepositoryInstructions } from '@chamvi/sandbox';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { createCredentialSupport } from '../../../src/manager/credentials.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { createScriptedWorkspace } from '../../utils/workspace.ts';

class ObservedClock extends ControllableClock {
    get pendingTimers(): number {
        return this.timers.length;
    }
}

function observe<T>(promise: Promise<T>) {
    const outcome: { value?: T; error?: unknown } = {};

    void promise.then((value) => {
        outcome.value = value;
    }, (error: unknown) => {
        outcome.error = error;
    });

    return outcome;
}

const absent = 'chamvi-instructions/1 inspect 2\n0 absent\n1 absent\nchamvi-instructions/1 end\n';

const cases = [
    ['timeout', 'success'],
    ['timeout', 'rejection'],
    ['caller abort', 'success'],
    ['caller abort', 'rejection'],
] as const;

describe('repository instruction exec settlement', () => {
    it.each(cases)('settles %s during a real credential refresh, ignoring late %s', async (interruption, late) => {
        const clock = new ObservedClock();
        const controller = new AbortController();
        const lookup = Promise.withResolvers<GitCredential | undefined>();
        let first = true;
        const raw = createScriptedWorkspace((_argv, options) => {
            if (options.signal?.aborted && late === 'rejection') {
                throw new SandboxError('late exec rejection');
            }

            return { stdout: absent };
        }, { repo: 'https://github.com/chamvi/chamvi.git' });
        const credentials = createCredentialSupport({
            clock,
            sources: [{
                get: () => {
                    if (!first) {
                        return Promise.resolve(undefined);
                    }

                    first = false;

                    return lookup.promise;
                },
            }],
            onError: () => {},
        });
        const outcome = observe(readRepositoryInstructions(credentials.wrap(raw), undefined, { clock, signal: controller.signal }));

        await setImmediate();
        expect(raw.calls).toEqual([]);

        if (interruption === 'timeout') {
            clock.advance(4_999);
            await setImmediate();
            expect(outcome).toEqual({});
            clock.advance(1);
        } else {
            controller.abort();
        }

        await setImmediate();

        expect(outcome.error).toBeInstanceOf(SandboxError);
        expect((outcome.error as Error).message).toMatch(interruption === 'timeout' ? /timed out/ : /abort/);
        expect(outcome.value).toBeUndefined();
        expect(clock.pendingTimers).toBe(0);

        const { error } = outcome;

        lookup.resolve(undefined);
        await setImmediate();
        expect(raw.calls.at(-1)?.options.signal?.aborted).toBe(true);
        expect(outcome).toEqual({ error });
        expect(clock.pendingTimers).toBe(0);
    });

    it.each(cases)('settles %s before the real remote guard, ignoring late transport %s', async (interruption, late) => {
        const clock = new ObservedClock();
        const controller = new AbortController();
        const transport = Promise.withResolvers<TransportExecResult>();
        let operationSignal: AbortSignal | undefined;
        const workspace = createRemoteWorkspace({
            id: 'remote',
            info: createScriptedWorkspace().info,
            clock,
            transport: {
                exec: (_argv, options) => {
                    operationSignal = options.signal;

                    return transport.promise;
                },
                remove: async () => {},
            },
        });
        const outcome = observe(readRepositoryInstructions(workspace, undefined, { clock, signal: controller.signal }));

        await setImmediate();

        if (interruption === 'timeout') {
            clock.advance(4_999);
            await setImmediate();
            expect(outcome).toEqual({});
            clock.advance(1);
        } else {
            controller.abort();
        }

        await setImmediate();

        expect(outcome.error).toBeInstanceOf(SandboxError);
        expect((outcome.error as Error).message).toMatch(interruption === 'timeout' ? /timed out/ : /abort/);
        expect(outcome.value).toBeUndefined();
        expect(operationSignal?.aborted).toBe(true);
        expect(clock.pendingTimers).toBe(0);

        const { error } = outcome;

        if (late === 'success') {
            transport.resolve({ exitCode: 0 });
        } else {
            transport.reject(new SandboxError('late transport rejection'));
        }

        await setImmediate();
        expect(outcome).toEqual({ error });
        clock.advance(60_000);
        expect(clock.pendingTimers).toBe(0);
    });

    it.each([
        ['credentials', 'success'],
        ['credentials', 'rejection'],
        ['remote', 'success'],
        ['remote', 'rejection'],
    ] as const)('keeps prior sources when the request expires during %s, ignoring late %s', async (provider, late) => {
        const clock = new ObservedClock();
        const lookup = Promise.withResolvers<GitCredential | undefined>();
        const transport = Promise.withResolvers<TransportExecResult>();
        const root = '@a.md\n';
        const inspection = 'chamvi-instructions/1 inspect 2\n0 file\n1 absent\nchamvi-instructions/1 end\n';
        const read = `chamvi-instructions/1 read file\n${Buffer.from(root).toString('base64')}\nchamvi-instructions/1 end\n`;
        const raw = createScriptedWorkspace((argv, options) => {
            if (options.signal?.aborted && late === 'rejection') {
                throw new SandboxError('late exec rejection');
            }

            return argv[4] === 'read' ? { stdout: read, stderr: 'chamvi-instructions/1 head 0\n' } : { stdout: inspection };
        });
        let firstLookup = true;
        const credentials = createCredentialSupport({
            clock,
            sources: [{
                get: () => {
                    if (!firstLookup) {
                        return Promise.resolve(undefined);
                    }

                    firstLookup = false;

                    return lookup.promise;
                },
            }],
            onError: () => {},
        });
        let calls = 0;
        let operationSignal: AbortSignal | undefined;
        const workspace = provider === 'credentials' ? credentials.wrap(raw) : createRemoteWorkspace({
            id: 'remote',
            info: raw.info,
            clock,
            transport: {
                exec: (_argv, options) => {
                    calls++;

                    if (calls > 2) {
                        operationSignal = options.signal;

                        return transport.promise;
                    }

                    options.stdout.write(Buffer.from(calls === 1 ? inspection : read));

                    if (calls === 2) {
                        options.stderr.write(Buffer.from('chamvi-instructions/1 head 0\n'));
                    }

                    return Promise.resolve({ exitCode: 0 });
                },
                remove: async () => {},
            },
        });

        workspace.redact = (text) => {
            if (text === root) {
                // Spend request budget between execs, then trigger the actual credential refresh.
                raw.info.repo = 'https://github.com/chamvi/chamvi.git';
                clock.advance(27_000);
            }

            return text;
        };

        const outcome = observe(readRepositoryInstructions(workspace, undefined, { clock }));

        await setImmediate();
        clock.advance(2_999);
        await setImmediate();
        expect(outcome).toEqual({});
        clock.advance(1);
        await setImmediate();

        expect(outcome.error).toBeUndefined();
        expect(outcome.value?.sources.map(({ path }) => path)).toEqual(['AGENTS.md']);
        expect(outcome.value?.sources[0]?.content).toBe(root);
        expect(outcome.value?.complete).toBe(false);
        expect(outcome.value?.diagnostics.map(({ code }) => code)).toEqual(['limit']);
        expect(clock.pendingTimers).toBe(0);

        const result = outcome.value;

        if (provider === 'credentials') {
            lookup.resolve(undefined);
        } else if (late === 'success') {
            transport.resolve({ exitCode: 0 });
        } else {
            transport.reject(new SandboxError('late transport rejection'));
        }

        await setImmediate();

        if (provider === 'credentials') {
            expect(raw.calls.at(-1)?.options.signal?.aborted).toBe(true);
        } else {
            expect(operationSignal?.aborted).toBe(true);
        }

        expect(outcome).toEqual({ value: result });
        expect(clock.pendingTimers).toBe(0);
    });

    it('keeps the first per-exec timeout when a clock advance also reaches the request deadline', async () => {
        const clock = new ObservedClock();
        const workspace = createScriptedWorkspace();

        workspace.exec = () => new Promise(() => {});

        const outcome = observe(readRepositoryInstructions(workspace, undefined, { clock }));

        await setImmediate();
        clock.advance(30_001);
        await setImmediate();
        expect(outcome.error).toBeInstanceOf(SandboxError);
        expect((outcome.error as Error).message).toMatch(/timed out/);
        expect(outcome.value).toBeUndefined();
        expect(clock.pendingTimers).toBe(0);
    });

    it('clears exec timers and removes its abort listener after a successful call', async () => {
        const clock = new ObservedClock();
        const add = vi.spyOn(AbortSignal.prototype, 'addEventListener');
        const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener');

        try {
            const workspace = createScriptedWorkspace(() => ({ stdout: absent }));
            const result = await readRepositoryInstructions(workspace, undefined, { clock });

            expect(result.complete).toBe(true);

            const operationSignal = workspace.calls[0]?.options.signal;
            const registrations = add.mock.calls.filter((_call, index) => add.mock.contexts[index] === operationSignal);

            expect(registrations).toHaveLength(1);
            expect(remove.mock.calls.some((call, index) => remove.mock.contexts[index] === operationSignal && call[0] === 'abort' && call[1] === registrations[0]?.[1])).toBe(true);
            expect(clock.pendingTimers).toBe(0);
        } finally {
            add.mockRestore();
            remove.mockRestore();
        }
    });
});
