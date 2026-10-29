/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { fileURLToPath } from 'node:url';
import { Engine, createMemoryStores } from '@chamvi/core';
import { createHttpApp, staticTokens } from '@chamvi/http';
import type { HttpAppOptions } from '@chamvi/http';
import { ControllableClock } from '@chamvi/test-kit';
import type { App } from 'routup';

export const FIXTURE_BUILD = fileURLToPath(new URL('../fixtures/build/', import.meta.url));

export const ADMIN_TOKEN = 'admin-token-0123456789';

/** An app without agents, the dashboard routes given. */
export function createUiTestApp(options: Partial<Omit<HttpAppOptions, 'engine' | 'auth'>> = {}): {
    app: App;
    errors: unknown[];
    clock: ControllableClock;
} {
    const clock = new ControllableClock(new Date(1_000_000));
    const engine = new Engine({
        stores: createMemoryStores({ clock }),
        agents: [],
        clock,
        onError: () => {},
    });
    const errors: unknown[] = [];
    const app = createHttpApp({
        engine,
        auth: [staticTokens({
            tokens: [{
                value: ADMIN_TOKEN,
                id: 'admin',
                permissions: ['*'],
            }],
        })],
        metrics: false,
        onError: (error) => { errors.push(error); },
        ...options,
    });
    return {
        app, 
        errors, 
        clock, 
    };
}

/** A GET with a socket address (the rate limiter keys by it). */
export function get(app: App, path: string): Promise<Response> {
    const request = new Request(`http://test${path}`);
    (request as Request & { ip?: string }).ip = '10.0.0.1';
    return app.fetch(request);
}
