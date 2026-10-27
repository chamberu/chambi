/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
    abortable,
    addRepoRoutes,
    base64UrlJson,
    compile,
    json,
    page,
} from './helpers.ts';
import type {
    FakeGithub,
    FakeGithubOptions,
    FakeRouteHandler,
    JwtClaims,
} from './types.ts';

type Route = {
    method: string;
    pattern: RegExp;
    names: string[];
    handler: FakeRouteHandler;
};

type IssuedToken = { installationId: number; expiresAt: number };

/**
 * An in-process GitHub: verifies App JWTs (RS256 under the fake's public key,
 * `iss`, at most 600 s) on `/app*` (incl. `GET /app/installations`) and `/repos/:owner/:repo/installation`,
 * answers `/users/:login` without credentials, and installation tokens on
 * every other route, issues tokens valid for one hour on the fake's clock, answers 404
 * for unknown routes. A request whose signal aborts (also while a route
 * handler is pending) rejects with the signal's reason, as Node's `fetch`
 * does. Never touches the network.
 */
export function createFakeGithub(input: FakeGithubOptions): FakeGithub {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const tokens = new Map<string, IssuedToken>();
    const routes: Route[] = [];
    const failures: Array<{
        method: string; 
        path: string; 
        status: number 
    }> = [];
    let issued = 0;

    const fake: FakeGithub = {
        fetch: undefined as unknown as typeof globalThis.fetch,
        privateKey: pem,
        publicKey,
        requests: [],
        jwtClaims: [],
        get tokensIssued() {
            return issued;
        },
        tokenInstallations: [],
        issues: new Map(),
        comments: new Map(),
        labels: new Map(),
        releases: new Map(),
        files: new Map(),
        pulls: new Map(),
        installations: new Map(),
        users: new Map(),
        repositories: new Map(),
        appInstallations: new Map(),
        checkRuns: new Map(),
        statuses: new Map(),
        branches: new Map(),
        rules: new Map(),
        route(method, path, handler) {
            routes.unshift({
                method, 
                ...compile(path), 
                handler, 
            });
        },
        failNext(method, path, status) {
            failures.push({
                method, 
                path, 
                status, 
            });
        },
    };

    function verifyJwt(authorization: string | null): boolean {
        const match = /^bearer (.+)$/i.exec(authorization ?? '');
        if (!match?.[1]) return false;
        const [header, payload, signature] = match[1].split('.');
        if (!header || !payload || !signature) return false;
        const verifier = createVerify('RSA-SHA256');
        verifier.update(`${header}.${payload}`);
        if (!verifier.verify(publicKey, Buffer.from(signature, 'base64url'))) return false;
        const head = base64UrlJson(header) as { alg?: string };
        const claims = base64UrlJson(payload) as JwtClaims;
        const now = Math.floor(input.clock.now().getTime() / 1000);
        if (head.alg !== 'RS256' || String(claims.iss) !== input.appId) return false;
        if (claims.exp - claims.iat > 600 || claims.exp <= now || claims.iat > now) return false;
        fake.jwtClaims.push(claims);
        return true;
    }

    function installationOf(authorization: string | null): number | undefined {
        const match = /^token (ghs_\d+)$/.exec(authorization ?? '');
        if (!match?.[1]) return undefined;
        const token = tokens.get(match[1]);
        if (!token || token.expiresAt <= input.clock.now().getTime()) return undefined;
        return token.installationId;
    }

    fake.fetch = async (resource, init) => {
        const response = await answer(resource, init);
        // a Response built in process has no url; Octokit's paginate reads it for object lists
        Object.defineProperty(response, 'url', { value: resource instanceof Request ? resource.url : String(resource) });
        return response;
    };

    const answer = async (resource: Parameters<typeof globalThis.fetch>[0], init: Parameters<typeof globalThis.fetch>[1]): Promise<Response> => {
        const request = new Request(resource as RequestInfo, init);
        const { signal } = request;
        if (signal.aborted) throw signal.reason;
        const url = new URL(request.url);
        const { method } = request;
        const path = url.pathname;
        const text = await request.text();
        const body: unknown = text ? JSON.parse(text) : undefined;
        const authorization = request.headers.get('authorization');
        fake.requests.push({
            method,
            path,
            query: Object.fromEntries(url.searchParams),
            body,
            authorization,
        });

        const failure = failures.findIndex((f) => f.method === method && f.path === path);
        if (failure !== -1) {
            const { status } = failures.splice(failure, 1)[0]!;
            return json(status, { message: 'Injected failure' });
        }

        if (path === '/app' || path.startsWith('/app/')) {
            if (!verifyJwt(authorization)) return json(401, { message: 'Bad credentials' });
            if (method === 'GET' && path === '/app') {
                return json(200, { id: Number(input.appId), slug: input.slug ?? 'chamvi-test' });
            }
            if (method === 'GET' && path === '/app/installations') {
                const result = page(path, Object.fromEntries(url.searchParams), Array.from(fake.appInstallations.values()));
                return json(result.status, result.body, result.headers);
            }
            const exchange = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
            if (method === 'POST' && exchange?.[1]) {
                issued++;
                const token = `ghs_${issued}`;
                const installationId = Number(exchange[1]);
                const expiresAt = input.clock.now().getTime() + 3_600_000;
                tokens.set(token, { installationId, expiresAt });
                fake.tokenInstallations.push(installationId);
                return json(201, { token, expires_at: new Date(expiresAt).toISOString() });
            }
            return json(404, { message: 'Not Found' });
        }

        const repoInstallation = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(path);
        if (method === 'GET' && repoInstallation) {
            if (!verifyJwt(authorization)) return json(401, { message: 'Bad credentials' });
            const id = fake.installations.get(`${decodeURIComponent(repoInstallation[1]!)}/${decodeURIComponent(repoInstallation[2]!)}`.toLowerCase());
            return id === undefined ? json(404, { message: 'Not Found' }) : json(200, { id });
        }
        const user = /^\/users\/([^/]+)$/.exec(path);
        if (method === 'GET' && user) {
            const login = decodeURIComponent(user[1]!);
            const id = fake.users.get(login);
            return id === undefined ? json(404, { message: 'Not Found' }) : json(200, {
                login, 
                id, 
                type: login.endsWith('[bot]') ? 'Bot' : 'User', 
            });
        }

        const installationId = installationOf(authorization);
        if (installationId === undefined) return json(401, { message: 'Bad credentials' });

        for (const route of routes) {
            if (route.method !== method) continue;
            const match = route.pattern.exec(path);
            if (!match) continue;
            const params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(match[i + 1] ?? '')]));
            const result = await abortable(Promise.resolve(route.handler({
                params,
                query: Object.fromEntries(url.searchParams),
                body,
                installationId,
            })), signal);
            return json(result.status, result.body, result.headers);
        }
        return json(404, { message: 'Not Found' });
    };

    fake.route('GET', '/rate_limit', () => ({ status: 200, body: { resources: {} } }));
    addRepoRoutes(fake, `${input.slug ?? 'chamvi-test'}[bot]`, input.clock);
    return fake;
}
