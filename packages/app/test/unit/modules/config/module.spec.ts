/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, systemClock } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { describe, expect, it } from 'vitest';
import { AppToken, ModuleName, configModule } from '@chamvi/app';
import { buildHarness, createHarness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';


describe('configModule', () => {
    it('registers config, clock and logger', async () => {
        const clock = new ControllableClock();
        const logger = createRecordingLogger();
        const module = configModule({ clock, logger });

        expect(module.name).toBe(ModuleName.CONFIG);
        expect(module.dependencies ?? []).toEqual([]);

        const harness = await createHarness({
            env: { PORT: '4000' },
            modules: [module],
        });

        expect(harness.container.resolve(AppToken.CONFIG).http.port).toBe(4000);
        expect(harness.container.resolve(AppToken.CLOCK)).toBe(clock);
        expect(harness.container.resolve(AppToken.LOGGER)).toBe(logger);
        await harness.stop();
    });

    it('defaults to the system clock and a JSON line logger', async () => {
        const harness = await createHarness({
            env: {},
            modules: [configModule()],
        });

        expect(harness.container.resolve(AppToken.CLOCK)).toBe(systemClock);

        const logger = harness.container.resolve(AppToken.LOGGER);

        expect(typeof logger.warn).toBe('function');
        await harness.stop();
    });

    it('an invalid env fails setup with InvalidAgentDefinitionError', async () => {
        const harness = buildHarness({
            env: { PORT: 'abc' },
            modules: [configModule({ logger: createRecordingLogger() })],
        });

        await expect(harness.setup()).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
    });

    it('logs nothing', async () => {
        const logger = createRecordingLogger();
        const harness = await createHarness({
            env: {},
            modules: [configModule({ logger })],
        });

        expect(logger.entries).toEqual([]);
        await harness.stop();
    });
});
