/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { Adapter } from 'chat';
import type { ChatApprovalRef } from '../channel/types.ts';

/** What createChatSender() sends through (internal). */
export type ChatSenderOptions = {
    /** The channel name, for error texts. */
    name: string;
    /** The adapters an address may name, by their name. */
    adapters: readonly Adapter[];
    /** The approval link; required to send an approval. */
    approvalUrl?: (ref: ChatApprovalRef) => string;
    /** Bound of one send. */
    timeoutMs: number;
    /**
     * The clock of a connected channel, else undefined: an offline channel
     * (not started, stopped, a transport that reports itself down) sends nothing.
     */
    online: () => IClock | undefined;
    /** Outcomes nobody waits for any more (a send that settled after its deadline or abort). */
    onError: (error: unknown) => void;
};

/** What renderChatMessage() reads of the options (internal). */
export type ChatRenderOptions = Pick<ChatSenderOptions, 'approvalUrl'>;
