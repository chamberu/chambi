/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createOutputCollector, createSinkStream } from '@chamvi/sandbox';

describe('createSinkStream', () => {
    it('hands every chunk to the sink', async () => {
        const collector = createOutputCollector(64);
        const stream = createSinkStream(collector);

        stream.write(new TextEncoder().encode('hello '));
        stream.write(new TextEncoder().encode('world'));
        await new Promise<void>((resolve) => {
            stream.end(resolve);
        });
        expect(collector.text()).toBe('hello world');
    });
});
