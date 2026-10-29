/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '@chamvi/core';
import type { Repositories } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import type { IShutdown } from '@chamvi/http';
import { call, createTestApp } from '../../utils/app.ts';

function storeWith(getRun: Repositories['runs']['findOne'], clock: ControllableClock): Repositories {
    const store = createMemoryRepositories({ clock });
    store.runs.findOne = getRun;
    return store;
}

const fakeShutdown = (shuttingDown: boolean): IShutdown => ({
    shuttingDown,
    onShutdown: () => () => {},
    shutdown: async () => {},
});

describe('GET /readyz', () => {
    it('answers ok without a token', async () => {
        const { app } = createTestApp();
        const response = await call(app, 'GET', '/readyz');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('fails while the engine drains', async () => {
        const { app, engine } = createTestApp();
        await engine.drain();
        const response = await call(app, 'GET', '/readyz');
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: 'unavailable', reason: 'draining' });
    });

    it('fails once the shutdown started', async () => {
        const { app } = createTestApp({ shutdown: fakeShutdown(true) });
        const response = await call(app, 'GET', '/readyz');
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: 'unavailable', reason: 'shutting-down' });
    });

    it('fails when the store rejects', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = storeWith(async () => {
            throw new Error('down');
        }, clock);
        const { app } = createTestApp({ clock, repositories: store });
        const response = await call(app, 'GET', '/readyz');
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: 'unavailable', reason: 'store-unreachable' });
    });

    it('fails when the store does not answer in time', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const store = storeWith(() => new Promise(() => {}), clock);
        const { app } = createTestApp({ clock, repositories: store });
        let settled = false;
        const pending = call(app, 'GET', '/readyz').then((response) => {
            settled = true;
            return response;
        });
        await new Promise((resolve) => { setImmediate(resolve); });
        expect(settled).toBe(false);
        clock.advance(2_000);
        const response = await pending;
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: 'unavailable', reason: 'store-unreachable' });
    });
});
