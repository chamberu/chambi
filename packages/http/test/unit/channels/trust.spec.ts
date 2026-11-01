/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { expect, it } from 'vitest';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { http, httpChannel, mcpChannel } from '@chamvi/http';
import { textModel } from '../../utils/model.ts';

async function taintOf(channel: IChannel) {
    const store = createMemoryStore();
    const engine = new Engine({
        store,
        channels: channel.name === 'http' ? [channel] : [httpChannel(), channel],
        agents: [defineAgent({
            name: 'echo',
            model: textModel(),
            instructions: 'Echo.',
            channels: [http.on()],
        })],
        onError: () => {},
    });
    const { runId } = await engine.dispatch({
        agent: 'echo',
        trigger: 'http',
        channel: channel.name,
        payload: {},
    });

    return (await store.runs.findOne(runId))?.taint;
}

it('keeps the http and mcp channels trusted by default', async () => {
    expect(httpChannel().untrusted).toBeUndefined();
    expect(mcpChannel().untrusted).toBeUndefined();
    expect(await taintOf(httpChannel())).toBeUndefined();
});

it.each([
    ['http', httpChannel],
    ['mcp', mcpChannel],
] as const)('taints every run of the %s channel with untrusted: true', async (name, factory) => {
    const channel = factory({ untrusted: true });

    expect(channel.untrusted).toBe(true);
    expect(await taintOf(channel)).toMatchObject({ source: `channel:${name}` });
});

it.each([
    [{ untrusted: 'yes' }],
    [{ untrustd: true }],
    ['options'],
])('refuses the options %j', (options) => {
    expect(() => httpChannel(options as never)).toThrow(InvalidAgentDefinitionError);
    expect(() => mcpChannel(options as never)).toThrow(InvalidAgentDefinitionError);
});
