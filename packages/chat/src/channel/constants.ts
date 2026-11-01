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

/** Default bound of one outbound send, below the engine's approval delivery lock (`claimTtlMs`, 60 s). */
export const CHAT_TIMEOUT_MS = 30_000;

/**
 * The longest text one send posts, in UTF-16 code units (JavaScript string
 * length), never split; a conservative default, not a platform limit.
 */
export const CHAT_TEXT_MAX_CHARS = 4096;

/** `code` of every transport failure of a send. */
export const CHAT_REQUEST_ERROR_CODE = 'chat_request';

/** The longest Node timer: a larger one fires after 1 ms. */
export const TIMER_MAX_MS = 2 ** 31 - 1;

/** The largest webhook body `in` reads (1 MiB); a larger one is refused (413) before the adapter sees it. */
export const CHAT_BODY_LIMIT_BYTES = 1_048_576;

/** How long `in` waits for the adapter and the messages it handed over to be accepted, before it answers 503. */
export const CHAT_WEBHOOK_TIMEOUT_MS = 30_000;

/** How long stop() waits for messages already being accepted. */
export const CHAT_STOP_TIMEOUT_MS = 30_000;

/** The code of the error stop() reports for messages still being accepted at its timeout. */
export const CHAT_STOP_TIMEOUT_ERROR_CODE = 'chat_stop_timeout';

/** The code of the error reported for a message that started not every run it should have. */
export const CHAT_INTAKE_FAILED_ERROR_CODE = 'chat_intake_failed';

/** A channel name: the agent name rule. */
export const CHANNEL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest channel name. */
export const CHANNEL_NAME_MAX_LENGTH = 64;
