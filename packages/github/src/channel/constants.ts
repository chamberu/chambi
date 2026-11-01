/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The default GitHub channel's name; `github.on()` subscribes to it, the http app serves it at `/channels/github`. */
export const GITHUB_CHANNEL_NAME = 'github';

/** Bound of one comment send (the comment list and the post), below the engine's approval send bound (`claimTtlMs`, 60 s). */
export const GITHUB_CHANNEL_TIMEOUT_MS = 30_000;

/** A message body is cut to this many characters (GitHub refuses comments over 65 536). */
export const COMMENT_BODY_MAX_LENGTH = 60_000;

/** Bytes a delivery may have by default (413 above), the http app's default body limit. */
export const DEFAULT_BODY_LIMIT = 1_048_576;

/** A channel name: the agent-name rule. */
export const CHANNEL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A GitHub login: letters, digits and single inner dashes, at most 39 characters. */
export const LOGIN_PATTERN = '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$';

/** The reconcile lists comments updated since the run's `receivedAt` minus this skew. */
export const RECONCILE_SKEW_MS = 3_600_000;

/** A message key used in the marker as is; others are hashed. */
export const SAFE_KEY_PATTERN = '^[\\w:.-]{1,255}$';

/** Backtick runs longer than this are broken up, so the body's fence stays short. */
export const BACKTICK_RUN_MAX_LENGTH = 31;

/** The first wait before a busy persistent slot's lock is asked again; doubled per attempt. */
export const SLOT_LOCK_RETRY_MS = 50;

/** The longest wait between two attempts on a busy slot's lock. */
export const SLOT_LOCK_RETRY_MAX_MS = 1_000;
