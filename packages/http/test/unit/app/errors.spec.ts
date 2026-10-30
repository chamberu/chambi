/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    BadRequestError,
    RequestEntityTooLargeError,
    UnauthorizedError,
} from '@ebec/http';
import { App, defineCoreHandler } from 'routup';
import { describe, expect, it } from 'vitest';
import {
    ArtifactNotFoundError,
    InvalidAgentDefinitionError,
    InvalidRunStateError,
    RunNotFoundError,
    ValidationError,
} from '@chamvi/core';
import { call, createTestApp } from '../../utils/app.ts';

function appThrowing(error: unknown, onError?: (error: unknown) => void) {
    // the app ends in a catch-all, so the throwing route goes in front of it
    const { app } = createTestApp({ onError });
    const outer = new App();

    outer.get('/boom', defineCoreHandler(() => {
        throw error;
    }));
    outer.use(app);

    return outer;
}

async function bodyOf(response: Response) {
    return await response.json() as Record<string, unknown>;
}

describe('error handler', () => {
    it('maps RunNotFoundError to 404', async () => {
        const response = await call(appThrowing(new RunNotFoundError('r1')), 'GET', '/boom');

        expect(response.status).toBe(404);
        expect(response.headers.get('content-type')).toMatch(/application\/json/);
        expect(await bodyOf(response)).toEqual({
            status: 404,
            code: 'run_not_found',
            message: 'Run "r1" was not found.',
        });
    });

    it('maps ArtifactNotFoundError to 404', async () => {
        const response = await call(appThrowing(new ArtifactNotFoundError('a1')), 'GET', '/boom');

        expect(response.status).toBe(404);
        expect(await bodyOf(response)).toEqual({
            status: 404,
            code: 'artifact_not_found',
            message: 'Artifact "a1" was not found.',
        });
    });

    it('maps InvalidRunStateError to 409', async () => {
        const response = await call(appThrowing(new InvalidRunStateError('nope')), 'GET', '/boom');

        expect(response.status).toBe(409);
        expect(await bodyOf(response)).toMatchObject({ code: 'invalid_run_state' });
    });

    it('maps core ValidationError to 400 with issues', async () => {
        const issue = {
            type: 'item' as const,
            code: 'value_invalid',
            path: ['n'],
            message: 'bad',
        };
        const response = await call(appThrowing(new ValidationError('bad', [issue])), 'GET', '/boom');

        expect(response.status).toBe(400);

        const body = await bodyOf(response);

        expect(body.code).toBe('validation_error');
        expect(body.issues).toHaveLength(1);
    });

    it('never renders a large received value', async () => {
        const big = {
            type: 'item' as const,
            code: 'value_invalid',
            path: ['a'],
            message: 'bad',
            received: 'x'.repeat(100_000),
        };
        const small = {
            type: 'item' as const,
            code: 'value_invalid',
            path: ['b'],
            message: 'bad',
            received: 'png',
        };
        const group = {
            type: 'group' as const,
            path: ['c'],
            message: 'bad',
            issues: [{ ...big, path: ['c', 0] }],
        };
        const response = await call(appThrowing(new ValidationError('bad', [big, small, group])), 'GET', '/boom');

        expect(response.status).toBe(400);

        const text = await response.text();

        expect(text.length).toBeLessThan(1024);

        const body = JSON.parse(text);

        expect(body.issues[0]).toEqual({
            type: 'item',
            code: 'value_invalid',
            path: ['a'],
            message: 'bad',
        });
        expect(body.issues[1]).toEqual(small);
        expect(body.issues[2].issues[0]).not.toHaveProperty('received');
    });

    it('maps an ebec HTTP error to its status and a lower-case code', async () => {
        const response = await call(appThrowing(new BadRequestError({ message: 'x' })), 'GET', '/boom');

        expect(response.status).toBe(400);
        expect(await bodyOf(response)).toEqual({
            status: 400,
            code: 'bad_request',
            message: 'x',
        });

        // validup's guard duck-types any error with issues: an HTTP error keeps its own code
        const issue = {
            type: 'item' as const,
            code: 'keyNotAllowed',
            path: ['nope'],
            message: 'no',
        };
        const withIssues = await call(appThrowing(new BadRequestError({ message: 'x', issues: [issue] })), 'GET', '/boom');

        expect(withIssues.status).toBe(400);
        expect(await bodyOf(withIssues)).toEqual({
            status: 400,
            code: 'bad_request',
            message: 'x',
            issues: [issue],
        });

        const tooLarge = await call(appThrowing(new RequestEntityTooLargeError()), 'GET', '/boom');

        expect(tooLarge.status).toBe(413);
        expect(await bodyOf(tooLarge)).toMatchObject({ code: 'request_entity_too_large' });
    });

    it('never sends the cause', async () => {
        const error = new BadRequestError({ message: 'x', cause: new Error('inner secret') });
        const response = await call(appThrowing(error), 'GET', '/boom');
        const text = await response.text();

        expect(text).not.toContain('inner secret');
        expect(JSON.parse(text)).not.toHaveProperty('cause');
    });

    it('answers 500 for anything else and reports it', async () => {
        const errors: unknown[] = [];
        const error = new Error('secret detail');
        const response = await call(appThrowing(error, (e) => {
            errors.push(e);
        }), 'GET', '/boom');

        expect(response.status).toBe(500);

        const text = await response.text();

        expect(text).not.toContain('secret detail');
        expect(JSON.parse(text)).toEqual({
            status: 500,
            code: 'internal_error',
            message: 'Internal Server Error',
        });
        expect(errors).toEqual([error]);
    });

    it('sets WWW-Authenticate on every 401', async () => {
        const response = await call(appThrowing(new UnauthorizedError({ message: 'no' })), 'GET', '/boom');

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
        expect(await bodyOf(response)).toMatchObject({ message: 'no' });
    });

    it('answers unknown routes with a JSON 404', async () => {
        const { app } = createTestApp();
        const response = await call(app, 'GET', '/nope');

        expect(response.status).toBe(404);
        expect(await bodyOf(response)).toEqual({
            status: 404,
            code: 'not_found',
            message: 'The requested route does not exist.',
        });
    });

    it('answers unknown routes under basePath with a JSON 404', async () => {
        const { app } = createTestApp({ basePath: '/api' });
        const response = await call(app, 'GET', '/api/nope');

        expect(response.status).toBe(404);
        expect(await bodyOf(response)).toEqual({
            status: 404,
            code: 'not_found',
            message: 'The requested route does not exist.',
        });
    });

    it('reads a basePath of "/" as no prefix', async () => {
        const { app } = createTestApp({ basePath: '/' });

        expect((await call(app, 'GET', '/healthz')).status).toBe(200);
    });

    it.each(['api', '/api/:id', '/a b', '/api//v1'])('refuses the basePath %j', (basePath) => {
        expect(() => createTestApp({ basePath })).toThrow(InvalidAgentDefinitionError);
    });
});

describe('createHttpApp', () => {
    it('rejects an empty auth chain', () => {
        expect(() => createTestApp({ auth: [] })).toThrow(InvalidAgentDefinitionError);
    });
});
