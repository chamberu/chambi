/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createMemoryStore, defineAgent } from '@chamvi/core';
import { ControllableClock, textModel } from '@chamvi/test-kit';
import { customProvider } from 'ai';
import { MockEmbeddingModelV4 } from 'ai/test';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    AppToken,
    configModule,
    engineModule,
    storeModule,
} from '@chamvi/app';
import type { AppMode } from '@chamvi/app';
import { buildHarness } from '../../../utils/harness.ts';
import type { Harness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';

let harnesses: Harness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
});

const embedding = new MockEmbeddingModelV4();

function build(options: { mode?: AppMode; check?: boolean } = {}): Harness {
    const clock = new ControllableClock(new Date('2026-11-01T00:00:00Z'));
    const harness = buildHarness({
        ...(options.mode !== undefined && { mode: options.mode }),
        ...(options.check !== undefined && { check: options.check }),
        // migrate mode needs a URL; the given store means nothing connects
        env: options.mode === 'migrate' ? { DATABASE_URL: 'postgres://u@127.0.0.1:1/x' } : {},
        agents: [defineAgent({
            name: 'triage', 
            model: 'fake/m', 
            instructions: 'triage', 
        })],
        models: {
            fake: customProvider({
                languageModels: { m: textModel() },
                embeddingModels: { e: embedding },
            }),
        },
        modules: [
            configModule({ clock, logger: createRecordingLogger(clock) }),
            storeModule({ store: createMemoryStore() }),
            engineModule(),
        ],
    });

    harnesses.push(harness);

    return harness;
}

describe('AppToken.MODELS', () => {
    it.each([
        ['start', undefined],
        ['job', undefined],
        ['start', true],
    ] as const)('holds the engine module\'s resolver (mode %s, check %s)', async (mode, check) => {
        const harness = build({ mode, ...(check !== undefined && { check }) });

        await harness.setup();

        const models = harness.container.resolve(AppToken.MODELS);

        expect(models.resolve('fake/m')).toBeDefined();
        expect(models.embedding?.('fake/e')).toBe(embedding);
    });

    it('is the resolver the engine checks agents with', async () => {
        const harness = build();

        await harness.setup();

        const models = harness.container.resolve(AppToken.MODELS);
        const engine = harness.container.resolve(AppToken.ENGINE);
        const seen: string[] = [];
        const original = models.check.bind(models);

        models.check = (ref: string, agent?: string) => {
            seen.push(ref);
            original(ref, agent);
        };

        engine.checkAgent(defineAgent({
            name: 'other', 
            model: 'fake/m', 
            instructions: 'other', 
        }));

        expect(seen).toEqual(['fake/m']);
    });

    it('is not registered in migrate mode', async () => {
        const harness = build({ mode: 'migrate' });

        await harness.setup();

        expect(harness.container.has(AppToken.MODELS)).toBe(false);
    });
});
