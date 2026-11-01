/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The default name of a chat channel. */
export const CHAT_CHANNEL_NAME = 'chat';

/** Every chat address starts with it: `chat:<base64url of the JSON [adapter, threadId]>`. */
export const CHAT_ADDRESS_PREFIX = 'chat:';

/** Default bound of one outbound send. */
export const CHAT_CHANNEL_TIMEOUT_MS = 30_000;

/** How long stop() waits for messages already being accepted. */
export const CHAT_STOP_TIMEOUT_MS = 30_000;

/** The code of the error stop() reports for messages still being accepted at its timeout. */
export const CHAT_STOP_TIMEOUT_ERROR_CODE = 'chat_stop_timeout';

/** A channel name: the agent name rule. */
export const CHANNEL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest channel name. */
export const CHANNEL_NAME_MAX_LENGTH = 64;
