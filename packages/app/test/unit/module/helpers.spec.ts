/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError } from '@chamvi/core';
import type { IEngine } from '@chamvi/core';
import type { IModule } from 'orkos';
import { describe, expect, it } from 'vitest';
import {
    APP_ERROR_CODE,
    AppToken,
    runHooks,
    throwIfStopped,
} from '@chamvi/app';
import type { ILifecycleHook } from '@chamvi/app';
import { reportingModule } from '../../../src/module/helpers.ts';
import { buildHarness, createHarness } from '../../utils/harness.ts';

const noop = async (): Promise<void> => undefined;

function hookModule(hooks: ILifecycleHook[]): IModule {
    return {
        name: 'test:hooks',
        async setup(container) {
            for (const hook of hooks) {
                container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: hook });
            }
        },
    };
}

describe('runHooks', () => {
    it('runs in registration order and only the given phase', async () => {
        const fakeEngine = {} as IEngine;
        const calls: string[] = [];
        const harness = await createHarness({
            modules: [hookModule([
                {
                    name: 'a',
                    engineCreated: (engine) => {
                        calls.push(`a:engineCreated:${engine === fakeEngine}`);
                    },
                    drained: () => {
                        calls.push('a:drained');
                    },
                },
                {
                    name: 'b',
                    drained: () => {
                        calls.push('b:drained');
                    },
                },
                {
                    name: 'c',
                    engineCreated: async () => {
                        await Promise.resolve();
                        calls.push('c:engineCreated');
                    },
                },
            ])],
        });

        await runHooks(harness.container, 'engineCreated', fakeEngine);
        expect(calls).toEqual(['a:engineCreated:true', 'c:engineCreated']);

        calls.length = 0;
        await runHooks(harness.container, 'drained');
        expect(calls).toEqual(['a:drained', 'b:drained']);

        await harness.stop();
    });

    it('a throwing hook is reported and the next runs', async () => {
        const calls: string[] = [];
        const boom = new Error('boom');
        const harness = await createHarness({
            modules: [hookModule([
                {
                    name: 'a',
                    started: () => {
                        throw boom;
                    },
                },
                {
                    name: 'b',
                    started: async () => {
                        throw new Error('async boom');
                    },
                },
                {
                    name: 'c',
                    started: () => {
                        calls.push('c');
                    },
                },
            ])],
        });

        await expect(runHooks(harness.container, 'started')).resolves.toBeUndefined();
        expect(calls).toEqual(['c']);
        expect(harness.reported).toHaveLength(2);
        expect(harness.reported[0]).toEqual({ error: boom, context: { hook: 'a', phase: 'started' } });
        expect(harness.reported[1]?.context).toEqual({ hook: 'b', phase: 'started' });

        await harness.stop();
    });

    it('runs nothing without hooks', async () => {
        const harness = await createHarness();

        await expect(runHooks(harness.container, 'stopping')).resolves.toBeUndefined();
        await harness.stop();
    });
});

describe('throwIfStopped', () => {
    it('throws the abort reason with code app_stopped', async () => {
        const harness = await createHarness();

        expect(() => throwIfStopped(harness.context)).not.toThrow();

        await harness.stop();

        let thrown: unknown;

        try {
            throwIfStopped(harness.context);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ChamviError);
        expect((thrown as ChamviError).code).toBe(APP_ERROR_CODE.STOPPED);
        expect(thrown).toBe(harness.context.signal.reason);
    });
});

describe('reportingModule', () => {
    it('reports a teardown throw and resolves', async () => {
        const boom = new Error('teardown failed');
        const reported: Array<{ error: unknown; context?: Record<string, unknown> }> = [];
        const wrapped = reportingModule({
            name: 'test:broken',
            setup: noop,
            async teardown() {
                throw boom;
            },
        }, (error, context) => {
            reported.push({ error, context });
        });

        const harness = buildHarness();

        await expect(wrapped.teardown!(harness.container)).resolves.toBeUndefined();
        expect(reported).toEqual([{ error: boom, context: { module: 'test:broken' } }]);
    });

    it('reports a teardown throw through an application', async () => {
        const boom = new Error('teardown failed');
        const harness = await createHarness({
            modules: [{
                name: 'test:broken',
                setup: noop,
                async teardown() {
                    throw boom;
                },
            }],
        });

        await harness.stop();
        expect(harness.reported).toEqual([{ error: boom, context: { module: 'test:broken' } }]);
    });

    it('keeps name and dependencies', () => {
        const module: IModule = {
            name: 'test:dep',
            version: '1.2.3',
            dependencies: ['chamvi:config', { name: 'chamvi:store', optional: true }],
            setup: noop,
            onReady: noop,
            onError: noop,
        };
        const wrapped = reportingModule(module, () => {});

        expect(wrapped.name).toBe('test:dep');
        expect(wrapped.version).toBe('1.2.3');
        expect(wrapped.dependencies).toBe(module.dependencies);
        expect(wrapped.onReady).toBeTypeOf('function');
        expect(wrapped.onError).toBeTypeOf('function');
    });

    it('delegates setup, onReady and onError to the module', async () => {
        const calls: string[] = [];
        const wrapped = reportingModule({
            name: 'test:delegate',
            async setup() {
                calls.push('setup');
            },
            async onReady() {
                calls.push('onReady');
            },
            async onError(error) {
                calls.push(`onError:${error.message}`);
            },
        }, () => {});
        const harness = buildHarness();

        await wrapped.setup(harness.container);
        await wrapped.onReady!(harness.container);
        await wrapped.onError!(new Error('x'), harness.container);
        expect(calls).toEqual(['setup', 'onReady', 'onError:x']);
    });

    it('omits hooks the module does not have', () => {
        const wrapped = reportingModule({ name: 'test:bare', setup: noop }, () => {});

        expect(wrapped.teardown).toBeUndefined();
        expect(wrapped.onReady).toBeUndefined();
        expect(wrapped.onError).toBeUndefined();
    });
});

describe('module constants', () => {
    it('names the aggregate store token chamvi.store', () => {
        expect(AppToken.STORE.name).toBe('chamvi.store');
        expect(AppToken).not.toHaveProperty('REPOSITORIES');
    });

    it('names every token chamvi.<token>', () => {
        for (const [key, token] of Object.entries(AppToken)) {
            expect(token.name).toBe(`chamvi.${key.toLowerCase().replace(/_/g, '-')}`);
        }
    });
});
