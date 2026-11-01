/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export {
    CHAT_ADDRESS_PREFIX,
    CHAT_BODY_LIMIT_BYTES,
    CHAT_CHANNEL_NAME,
    CHAT_INTAKE_FAILED_ERROR_CODE,
    CHAT_REQUEST_ERROR_CODE,
    CHAT_STOP_TIMEOUT_ERROR_CODE,
    CHAT_STOP_TIMEOUT_MS,
    CHAT_TEXT_MAX_CHARS,
    CHAT_TIMEOUT_MS,
    CHAT_WEBHOOK_TIMEOUT_MS,
} from './constants.ts';
export { chatChannel } from './module.ts';
export type {
    ChatApprovalRef,
    ChatChannel,
    ChatChannelOptions,
    ChatEvent,
    ChatPayload,
} from './types.ts';
