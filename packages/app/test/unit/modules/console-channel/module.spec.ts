/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { AppToken, ModuleName, consoleChannelModule } from '@chamvi/app';
import { createHarness } from '../../../utils/harness.ts';

describe('consoleChannelModule', () => {
    it('contributes a channel named console', async () => {
        const module = consoleChannelModule();

        expect(module.name).toBe(ModuleName.CONSOLE);
        expect(module.name).toBe('chamvi:console');
        expect(module.dependencies ?? []).toEqual([]);

        const harness = await createHarness({ modules: [module] });
        const channels = harness.container.resolveAll(AppToken.CHANNELS);

        expect(channels.map((channel) => channel.name)).toEqual(['console']);
        await harness.stop();
    });

    it('a named channel names its module and writes its messages', async () => {
        const lines: string[] = [];
        const module = consoleChannelModule({
            name: 'ops',
            write: (line) => {
                lines.push(line);
            },
        });

        expect(module.name).toBe('chamvi:console:ops');

        const harness = await createHarness({ modules: [module] });
        const [channel] = harness.container.resolveAll(AppToken.CHANNELS);

        expect(channel!.name).toBe('ops');
        expect(channel!.in).toBeUndefined();
        await channel!.out!({
            kind: 'message',
            key: 'k',
            agent: 'a',
            runId: 'r',
            title: 'done',
            body: 'ok',
        }, '', { signal: new AbortController().signal, trigger: undefined as never });
        expect(lines[0]).toContain('done');
        await harness.stop();
    });

    it('contributes nothing in migrate mode', async () => {
        const harness = await createHarness({ mode: 'migrate', modules: [consoleChannelModule()] });

        expect(harness.container.resolveAll(AppToken.CHANNELS)).toEqual([]);
        await harness.stop();
    });
});
