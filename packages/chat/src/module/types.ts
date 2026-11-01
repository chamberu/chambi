/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChatChannel } from '../channel/types.ts';

export type ChatModuleOptions = {
    /** A channel of chatChannel() (of this copy of the package), built by the app's entry with its Chat, adapters and policy. */
    channel: ChatChannel;
};
