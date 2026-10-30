/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    createApp,
    cron,
    defineAgent,
    http,
} from '@chamvi/app';
import { MockLanguageModelV4 } from 'ai/test';

/** A model whose stream starts and never ends, so a run stays in flight until the process dies. */
declare global {
    // set once the model was called, so a test knows a run is in flight
    var chamviHangStreaming: boolean | undefined;
}

const hangingModel = new MockLanguageModelV4({
    doStream: async () => {
        globalThis.chamviHangStreaming = true;

        return {
            stream: new ReadableStream({
                start(controller) {
                    controller.enqueue({ type: 'stream-start', warnings: [] });
                },
            }),
        };
    },
});

const hang = defineAgent({
    name: 'hang',
    model: hangingModel,
    instructions: 'Never answer.',
    channels: [http.on(), cron.on('0 0 1 1 *')],
});

export default createApp({ agents: [hang] });
