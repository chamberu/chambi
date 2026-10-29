/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { AppToken, ModuleName, createApp } from '@chamvi/app';
import type { AppContext } from '@chamvi/app';
import { echo } from '../../app/src/agents.ts';

declare global {
    // set while the store module waits, so a test knows start is mid-setup
    var chamviSlowStoreWaiting: boolean | undefined;
}

/** A store module whose setup waits until the app stops (a migration that never ends). */
const slowRepository = {
    name: ModuleName.STORE,
    dependencies: [ModuleName.CONFIG],
    async setup(container: { resolve(token: typeof AppToken.CONTEXT): AppContext }): Promise<void> {
        const { signal } = container.resolve(AppToken.CONTEXT);
        globalThis.chamviSlowStoreWaiting = true;
        await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
        });
        globalThis.chamviSlowStoreWaiting = false;
        throw signal.reason;
    },
};

export default createApp({ agents: [echo], modules: [slowRepository] });
