/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** `name` or `name.action`, as GitHub spells event names and actions. */
export const GITHUB_EVENT_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)?$/;

/**
 * Events `selfEvents` may never name: a comment, issue or review comment
 * the bot writes would start the agent again (a loop).
 */
export const SELF_EVENTS_REFUSED = ['issue_comment', 'issues', 'pull_request_review_comment'];
