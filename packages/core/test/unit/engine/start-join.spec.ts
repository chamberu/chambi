/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { afterEach, expect, it } from 'vitest';
import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { mockModel } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.stop()));
});

function setup() {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const slow: IChannel = {
        name: 'slow',
        start: async () => {
            entered.resolve();
            await gate.promise;
        },
    };
    const engine = new Engine({
        store: createMemoryStore(),
        channels: [slow],
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            model: mockModel([{ parts: [{ type: 'text', text: 'done' }] }]),
        })],
    });

    engines.push(engine);

    return {
        engine,
        gate,
        entered,
    };
}

it('lets a joining caller stop waiting without cancelling the start it joined', async () => {
    const {
        engine, 
        gate, 
        entered, 
    } = setup();
    const first = engine.start();

    await entered.promise;

    const controller = new AbortController();
    const second = engine.start({ signal: controller.signal });
    const reason = new Error('second caller gave up');

    controller.abort(reason);
    await expect(second).rejects.toBe(reason);

    gate.resolve();
    await expect(first).resolves.toBeUndefined();

    const { runId } = await engine.dispatch({
        agent: 'test',
        trigger: 'test',
        channel: 'slow',
        payload: {},
    });

    await engine.idle();
    expect((await engine.getRun(runId))?.status).toBe('completed');
});

it('rejects a joining caller whose signal is already aborted and keeps the start running', async () => {
    const {
        engine, 
        gate, 
        entered, 
    } = setup();
    const first = engine.start();

    await entered.promise;

    const reason = new Error('aborted before joining');

    await expect(engine.start({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    gate.resolve();
    await expect(first).resolves.toBeUndefined();
});
