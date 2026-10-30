/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { assertChannelName } from './helpers.ts';
import type { ConsoleChannelOptions, IChannel } from './types.ts';

/**
 * A channel for development, out only: writes each message as a few lines
 * to `write` (`console.log` by default), the header, the body lines and, for
 * an approval, its options (`option <id>: <label>`) and until when it waits. Never throws, so an approval delivered
 * here counts as sent at once. Its `defaultAddress` is its name, so tools
 * emit to it without an address.
 */
export function consoleChannel(options: ConsoleChannelOptions = {}): IChannel {
    const name = options.name ?? 'console';

    assertChannelName(name);

    // eslint-disable-next-line no-console
    const write = options.write ?? ((line: string) => console.log(line));

    return {
        name,
        defaultAddress: name,
        async out(message) {
            try {
                const lines = message.body.split('\n');

                write(`[chamvi] ${message.kind}: ${message.title ?? lines[0]} (agent ${message.agent}, run ${message.runId}, key ${message.key})`);

                for (const line of lines) {
                    write(line);
                }

                if (message.kind === 'approval') {
                    if (message.options !== undefined && message.options.length > 0) {
                        write(message.multiple === true ? 'select one or more:' : 'select one:');

                        for (const option of message.options) {
                            write(`option ${option.id}: ${option.label}`);
                        }
                    }

                    const until = message.expiresAt ? ` waits until ${message.expiresAt.toISOString()}` : ' waits';

                    write(`approval ${message.approvalId}${until}`);
                }
            } catch {
                // a console that cannot write loses the message, never the run
            }
        },
    };
}
