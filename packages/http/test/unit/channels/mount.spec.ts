/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
} from 'vitest';
import {
    Engine,
    InvalidAgentDefinitionError,
    ValidationError,
    createMemoryStores,
    defineAgent,
} from '@chamvi/core';
import type { ChannelContext, ChannelRequest, IChannel } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    createHttpApp,
    http,
    httpChannel,
    readRequestBody,
} from '@chamvi/http';
import type { App } from 'routup';
import { testAuth } from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

type Seen = {
    subpath: string; 
    body: string; 
    method: string; 
    url: string 
};

/** A channel whose `in` records what it got and answers 200 with `{ ok: true }`. */
function recordingChannel(name: string, seen: Seen[]): IChannel {
    return {
        name,
        async in(input: ChannelRequest) {
            seen.push({
                subpath: input.subpath,
                body: await input.request.text(),
                method: input.request.method,
                url: input.request.url,
            });
            return Response.json({ ok: true }, { status: 200, headers: { 'x-channel': name } });
        },
    };
}

function setup(channels: IChannel<any, any>[], mounted: IChannel<any, any>[] = channels, basePath?: string) {
    const clock = new ControllableClock(new Date(1_000_000));
    const engine = new Engine({
        stores: createMemoryStores({ clock }),
        agents: [defineAgent({
            name: 'echo',
            model: textModel(),
            instructions: 'Echo.',
            channels: [http.on()],
        })],
        clock,
        channels: [httpChannel(), ...channels],
        onError: () => {},
    });
    const errors: unknown[] = [];
    const app = createHttpApp({
        engine,
        auth: testAuth,
        metrics: false,
        rateLimit: false,
        channels: mounted,
        ...(basePath ? { basePath } : {}),
        onError: (error) => { errors.push(error); },
    });
    return {
        app, 
        engine, 
        errors, 
    };
}

const post = (app: App, path: string, body?: string, headers: Record<string, string> = {}) => app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body } : {}),
}));

describe('/channels/<name> mount', () => {
    it('an unlisted channel name answers 404 and no in() runs', async () => {
        const seenListed: Seen[] = [];
        const seenUnlisted: Seen[] = [];
        const listed = recordingChannel('listed', seenListed);
        const unlisted = recordingChannel('unlisted', seenUnlisted);
        const { app } = setup([listed, unlisted], [listed]);

        for (const path of ['/channels/unlisted', '/channels/unlisted/x', '/channels/nope/x', '/channels']) {
            const response = await post(app, path, '{}', { 'content-type': 'application/json' });
            expect(response.status).toBe(404);
            expect((await response.json()).code).toBe('not_found');
        }
        expect(seenUnlisted).toEqual([]);
        expect(seenListed).toEqual([]);
    });

    it('a listed channel\'s thrown ChamviError renders through the JSON error handler', async () => {
        const failing: IChannel = {
            name: 'failing',
            async in() {
                throw new ValidationError('The delivery is malformed.');
            },
        };
        const { app, errors } = setup([failing]);
        const response = await post(app, '/channels/failing/x', '{}');
        expect(response.status).toBe(400);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({
            status: 400,
            code: 'validation_error',
            message: 'The delivery is malformed.',
        });
        expect(errors).toEqual([]);
    });

    it('a listed channel\'s unexpected error is a 500 reported to onError', async () => {
        const boom = new Error('boom');
        const failing: IChannel = {
            name: 'failing',
            async in() {
                throw boom;
            },
        };
        const { app, errors } = setup([failing]);
        const response = await post(app, '/channels/failing', '{}');
        expect(response.status).toBe(500);
        expect((await response.json()).message).toBe('Internal Server Error');
        expect(errors).toEqual([boom]);
    });

    it('in() gets the raw subpath and the request with its body', async () => {
        const seen: Seen[] = [];
        const { app } = setup([recordingChannel('rec', seen)], undefined, '/api');

        const bare = await post(app, '/api/channels/rec', 'one');
        expect(bare.status).toBe(200);
        expect(bare.headers.get('x-channel')).toBe('rec');
        expect(await bare.json()).toEqual({ ok: true });

        await post(app, '/api/channels/rec/', 'two');
        await post(app, '/api/channels/rec/Agent/Deep%2Fpath?x=1', 'three');
        expect(seen).toEqual([
            {
                subpath: '', 
                body: 'one', 
                method: 'POST', 
                url: 'http://test/api/channels/rec',
            },
            {
                subpath: '/', 
                body: 'two', 
                method: 'POST', 
                url: 'http://test/api/channels/rec/',
            },
            {
                subpath: '/Agent/Deep%2Fpath', 
                body: 'three', 
                method: 'POST', 
                url: 'http://test/api/channels/rec/Agent/Deep%2Fpath?x=1',
            },
        ]);
    });

    it('serves POST only', async () => {
        const seen: Seen[] = [];
        const { app } = setup([recordingChannel('rec', seen)]);
        const response = await app.fetch(new Request('http://test/channels/rec/x'));
        expect(response.status).toBe(404);
        expect(seen).toEqual([]);
    });

    it('is not authenticated by the app', async () => {
        const seen: Seen[] = [];
        const { app } = setup([recordingChannel('rec', seen)]);
        const response = await post(app, '/channels/rec', 'x', { authorization: 'Bearer unknown-token-0123456789' });
        expect(response.status).toBe(200);
        expect(seen).toHaveLength(1);
    });

    it('a body readRequestBody refuses answers 413 and closes the connection', async () => {
        const limited: IChannel = {
            name: 'limited',
            async in({ request }) {
                await readRequestBody(request, { limit: 4 });
                return new Response(null, { status: 204 });
            },
        };
        const { app, errors } = setup([limited]);
        const response = await post(app, '/channels/limited', 'too large');
        expect(response.status).toBe(413);
        expect(response.headers.get('connection')).toBe('close');
        expect(await response.json()).toMatchObject({ status: 413, code: 'request_entity_too_large' });
        expect(errors).toEqual([]);
        expect((await post(app, '/channels/limited', 'ok')).status).toBe(204);
    });

    it('dispatches as the channel through the context it hands to in()', async () => {
        let context: ChannelContext | undefined;
        const intake: IChannel = {
            name: 'intake',
            async in(_input, ctx) {
                context = ctx;
                const result = await ctx.dispatch({
                    agent: 'echo', 
                    trigger: 'http', 
                    payload: {},
                });
                return Response.json(result, { status: 202 });
            },
        };
        const { app, engine } = setup([intake]);
        const response = await post(app, '/channels/intake', '');
        expect(response.status).toBe(202);
        const { runId } = await response.json() as { runId: string };
        expect(context?.engine).toBe(engine);
        expect((await engine.getRun(runId))?.trigger.channel).toBe('intake');
    });

    it.each([
        ['a channel without in', (): IChannel => ({ name: 'outbound', out: async () => {} }), true],
        ['a channel the engine does not hold', (): IChannel => recordingChannel('stranger', []), false],
    ])('refuses %s at construction', (_name, make, registered) => {
        const channel = make();
        expect(() => setup(registered ? [channel] : [], [channel])).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses a channel listed twice', () => {
        const channel = recordingChannel('twice', []);
        expect(() => setup([channel], [channel, channel])).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses another object under a registered channel\'s name', () => {
        const registered = recordingChannel('same', []);
        expect(() => setup([registered], [recordingChannel('same', [])])).toThrow(InvalidAgentDefinitionError);
    });
});
