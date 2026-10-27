/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { KeyObject } from 'node:crypto';
import type { IClock } from '@chamvi/core';

export type FakeRequest = {
    method: string;
    path: string;
    query: Record<string, string>;
    body: unknown;
    authorization: string | null;
};

export type JwtClaims = {
    iat: number;
    exp: number;
    iss: string;
};

export type FakeRouteInput = {
    params: Record<string, string>;
    query: Record<string, string>;
    body: unknown;
    /** The installation the token belongs to. */
    installationId: number;
};

export type FakeRouteResult = {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
};

export type FakeRouteHandler = (input: FakeRouteInput) => FakeRouteResult | Promise<FakeRouteResult>;

export type FakeGithub = {
    fetch: typeof globalThis.fetch;
    /** PKCS#1 PEM of the App's private key. */
    privateKey: string;
    publicKey: KeyObject;
    requests: FakeRequest[];
    /** Claims of every JWT the fake accepted, in order. */
    jwtClaims: JwtClaims[];
    readonly tokensIssued: number;
    /** Installation id of every issued token, in order. */
    tokenInstallations: number[];
    issues: Map<string, Record<string, unknown>>;
    comments: Map<string, Array<Record<string, unknown>>>;
    labels: Map<string, Array<Record<string, unknown>>>;
    /** Per `owner/repo`, oldest first: the last one is the latest, the list route answers newest first. */
    releases: Map<string, Array<Record<string, unknown>>>;
    files: Map<string, Record<string, unknown>>;
    pulls: Map<string, Record<string, unknown>>;
    /** The installation of a repository (`owner/repo`, lower case) for `GET /repos/:owner/:repo/installation` (App JWT); 404 when missing. A token of another installation gets 404 on every `/repos/:owner/:repo` route of a repository listed here, as on GitHub. */
    installations: Map<string, number>;
    /** The `GET /repos/:owner/:repo` body per `owner/repo`; a missing one answers a synthesized public repository (default branch `main`). */
    repositories: Map<string, Record<string, unknown>>;
    /** The `GET /app/installations` items by installation id (App JWT). */
    appInstallations: Map<number, Record<string, unknown>>;
    /** Check runs per `owner/repo@<sha>` (`GET /repos/:owner/:repo/commits/:ref/check-runs`). */
    checkRuns: Map<string, Array<Record<string, unknown>>>;
    /** Commit statuses per `owner/repo@<sha>`, latest per context (`GET /repos/:owner/:repo/commits/:ref/status`, the combined state derived). */
    statuses: Map<string, Array<Record<string, unknown>>>;
    /** The `GET /repos/:owner/:repo/branches/:branch` body per `owner/repo:<branch>`; a missing one is unprotected. */
    branches: Map<string, Record<string, unknown>>;
    /** The rules of a branch per `owner/repo:<branch>` (`GET /repos/:owner/:repo/rules/branches/:branch`); missing reads `[]`. */
    rules: Map<string, Array<Record<string, unknown>>>;
    /** The user id of a login for `GET /users/:login` (public, no credentials needed); 404 when missing. */
    users: Map<string, number>;
    /** Adds a route (it wins over the built-in ones) for an installation token, e.g. `route('GET', '/repos/:owner/:repo/issues/:number', ...)`. */
    route(method: string, path: string, handler: FakeRouteHandler): void;
    /** The next request matching method and path answers `status` (once). */
    failNext(method: string, path: string, status: number): void;
};

export type FakeGithubOptions = {
    appId: string;
    /** The App's slug (default `chamvi-test`); its bot login is `<slug>[bot]`. */
    slug?: string;
    /** Token expiry and JWT checks read `now()` only. */
    clock: IClock;
};
