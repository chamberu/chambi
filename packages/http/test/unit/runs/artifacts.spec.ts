/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    ADMIN_TOKEN,
    READER_TOKEN,
    call,
    createRunTestApp,
    tokenFor,
} from '../../utils/app.ts';

type Ctx = ReturnType<typeof createRunTestApp>;

type Attachment = {
    mediaType: string;
    filename?: string;
    data: string
};

async function startWith(ctx: Ctx, attachments: Attachment[], agent = 'echo'): Promise<string> {
    const response = await call(ctx.app, 'POST', `/agents/${agent}/runs`, { token: ADMIN_TOKEN, body: { attachments } });
    expect(response.status).toBe(202);
    return (await response.json() as { runId: string }).runId;
}

function b64(bytes: Uint8Array | string): string {
    return Buffer.from(bytes).toString('base64');
}

describe('GET /runs/:id/artifacts', () => {
    it('lists the run artifacts as metadata', async () => {
        const ctx = createRunTestApp();
        const runId = await startWith(ctx, [
            {
                mediaType: 'text/plain',
                filename: 'a.txt',
                data: b64('alpha'),
            },
            { mediaType: 'image/png', data: b64('beta') },
        ]);
        const response = await call(ctx.app, 'GET', `/runs/${runId}/artifacts`, { token: READER_TOKEN });
        expect(response.status).toBe(200);
        const { data } = await response.json() as { data: Array<Record<string, unknown>> };
        const stored = await ctx.stores.artifacts.listArtifacts(runId);
        expect(data).toEqual(stored.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })));
        expect(data).toHaveLength(2);
        // in the order the client sent them
        expect(data.map((item) => item.mediaType)).toEqual(['text/plain', 'image/png']);
        expect(data[0]!.id).toBe(`${runId}.0000`);
        for (const item of data) expect(item).not.toHaveProperty('data');
    });

    it('answers an empty list for a run without artifacts', async () => {
        const ctx = createRunTestApp();
        const runId = await startWith(ctx, []);
        const response = await call(ctx.app, 'GET', `/runs/${runId}/artifacts`, { token: READER_TOKEN });
        expect(await response.json()).toEqual({ data: [] });
    });

    it('follows the run read rule: 401, 404, 403', async () => {
        const ctx = createRunTestApp();
        const runId = await startWith(ctx, [{ mediaType: 'text/plain', data: b64('x') }]);
        expect((await call(ctx.app, 'GET', `/runs/${runId}/artifacts`)).status).toBe(401);
        expect((await call(ctx.app, 'GET', '/runs/nope/artifacts', { token: tokenFor() })).status).toBe(404);
        expect((await call(ctx.app, 'GET', `/runs/${runId}/artifacts`, { token: tokenFor() })).status).toBe(403);
        expect((await call(ctx.app, 'GET', `/runs/${runId}/artifacts`, { token: tokenFor('agent:echo:run') })).status).toBe(200);
        expect((await call(ctx.app, 'GET', `/runs/${runId}/artifacts`, { token: tokenFor('agent:gate:run') })).status).toBe(403);
    });
});

describe('GET /runs/:id/artifacts/:artifactId', () => {
    it('answers the bytes with the stored media type and safe headers', async () => {
        const ctx = createRunTestApp();
        const bytes = new Uint8Array([0, 1, 2, 250, 255]);
        const runId = await startWith(ctx, [{ mediaType: 'image/png', data: b64(bytes) }]);
        const [artifact] = await ctx.stores.artifacts.listArtifacts(runId);

        const response = await call(ctx.app, 'GET', `/runs/${runId}/artifacts/${artifact!.id}`, { token: READER_TOKEN });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('content-length')).toBe('5');
        expect(response.headers.get('content-disposition')).toBe('attachment');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });

    it('names the file with an RFC 5987 filename*', async () => {
        const ctx = createRunTestApp();
        const runId = await startWith(ctx, [{
            mediaType: 'text/plain',
            filename: 'résumé "v1" (final).txt',
            data: b64('x'),
        }]);
        const [artifact] = await ctx.stores.artifacts.listArtifacts(runId);
        const response = await call(ctx.app, 'GET', `/runs/${runId}/artifacts/${artifact!.id}`, { token: ADMIN_TOKEN });
        expect(response.headers.get('content-disposition')).toBe(
            'attachment; filename="r_sum_ _v1_ (final).txt"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%20%22v1%22%20%28final%29.txt',
        );
    });

    it('answers 404 for an unknown artifact', async () => {
        const ctx = createRunTestApp();
        const runId = await startWith(ctx, []);
        const response = await call(ctx.app, 'GET', `/runs/${runId}/artifacts/nope`, { token: READER_TOKEN });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ status: 404, code: 'artifact_not_found' });
    });

    it('answers 404 for an artifact of another run', async () => {
        const ctx = createRunTestApp();
        const own = await startWith(ctx, []);
        const other = await startWith(ctx, [{ mediaType: 'text/plain', data: b64('secret') }], 'gate');
        const [artifact] = await ctx.stores.artifacts.listArtifacts(other);
        const response = await call(ctx.app, 'GET', `/runs/${own}/artifacts/${artifact!.id}`, { token: tokenFor('agent:echo:run') });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'artifact_not_found' });
    });

    it('follows the run read rule before it looks up the artifact', async () => {
        const ctx = createRunTestApp();
        const runId = await startWith(ctx, [{ mediaType: 'text/plain', data: b64('x') }]);
        const [artifact] = await ctx.stores.artifacts.listArtifacts(runId);
        const path = `/runs/${runId}/artifacts/${artifact!.id}`;
        expect((await call(ctx.app, 'GET', path)).status).toBe(401);
        expect((await call(ctx.app, 'GET', `/runs/nope/artifacts/${artifact!.id}`, { token: tokenFor() })).status).toBe(404);
        expect((await call(ctx.app, 'GET', path, { token: tokenFor() })).status).toBe(403);
        expect((await call(ctx.app, 'GET', `/runs/${runId}/artifacts/nope`, { token: tokenFor() })).status).toBe(403);
    });
});
