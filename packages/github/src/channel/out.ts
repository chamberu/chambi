/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash, randomUUID } from 'node:crypto';
import { isObject } from 'smob';
import {
    ChamviError,
    InvalidAgentDefinitionError,
    ValidationError,
    effectMarker,
} from '@chamvi/core';
import type { ChannelMessage, ChannelSendOptions, TriggerEnvelope } from '@chamvi/core';
import { isSameLogin } from '../app/helpers.ts';
import { isPositiveInteger } from '../subscription/helpers.ts';
import { GITHUB_REQUEST_ERROR_CODE } from '../tools/constants.ts';
import { untilAborted } from '../tools/helpers.ts';
import { RECONCILE_SKEW_MS } from './constants.ts';
import { markerKey, parseAddress, renderComment } from './helpers.ts';
import type { ResolvedGithubChannelOptions } from './types.ts';

function requestError(error: unknown): ChamviError {
    if (error instanceof ChamviError) {
        return error;
    }

    const status = isObject(error) && typeof error.status === 'number' ? error.status : undefined;
    const message = Error.isError(error) ? error.message : String(error);

    return new ChamviError({
        message: status !== undefined ? `GitHub ${status}: ${message}` : `GitHub request failed: ${message}`,
        code: GITHUB_REQUEST_ERROR_CODE,
    });
}

/**
 * The installation to comment as, the github tools' rule: the event's for a
 * run this channel started on the address's repository (no request), else
 * the App's installation on that repository, else the event's for a run
 * this channel started, else the app's `installationId`. Without any an
 * InvalidAgentDefinitionError, thrown before any comment request; a failed
 * lookup is a `github_request` ChamviError.
 */
async function installationOf(
    target: { owner: string; repo: string },
    message: ChannelMessage,
    trigger: TriggerEnvelope,
    options: ResolvedGithubChannelOptions,
): Promise<number> {
    const { payload } = trigger;
    const event = trigger.channel === options.name && isObject(payload) && isPositiveInteger(payload.installationId) ?
        payload.installationId :
        undefined;

    if (event !== undefined && isObject(payload)) {
        const body = isObject(payload.payload) ? payload.payload : {};
        const repository = isObject(body.repository) ? body.repository.full_name : undefined;

        if (typeof repository === 'string' && repository.toLowerCase() === `${target.owner}/${target.repo}`.toLowerCase()) {
            return event;
        }
    }

    let found: number | undefined;

    try {
        found = await options.app.installationFor(target);
    } catch (error) {
        throw requestError(error);
    }

    if (found !== undefined) {
        return found;
    }

    if (event !== undefined) {
        return event;
    }

    if (options.app.installationId !== undefined) {
        return options.app.installationId;
    }

    throw new InvalidAgentDefinitionError(
        `githubChannel: run ${message.runId} of agent "${message.agent}" has no GitHub installation; ` +
        'install the App on the repository or set installationId on createGithubApp() for runs not started by a GitHub delivery.',
    );
}

/**
 * The channel's `out`: one comment on the issue or pull request `address`
 * (`owner/repo#n`) as the GitHub App, carrying `effectMarker(message.key)`.
 * A resend first looks for the App bot's comment holding the marker and
 * posts nothing when it finds one. Persistent mode locks a stable slot,
 * searches without a time cutoff, then PATCHes that bot's matching comment.
 * Throws a ValidationError for another
 * address (before any request) and InvalidAgentDefinitionError without an
 * installation (before any comment request), a `github_request` ChamviError for a GitHub failure
 * or a GitHub that does not answer within `timeoutMs`, and the caller's
 * abort reason when `opts.signal` aborts.
 */
export function createCommentSender(options: ResolvedGithubChannelOptions) {
    const { app } = options;

    return async (message: ChannelMessage, address: string, opts: ChannelSendOptions): Promise<void> => {
        const target = parseAddress(address);

        if (!target) {
            throw new ValidationError(`The GitHub channel needs an address like "owner/repo#12", got ${JSON.stringify(address)}.`);
        }

        if (message.slot !== undefined && (typeof message.slot !== 'string' || message.slot.trim().length === 0 || message.slot.includes('\0') || !message.slot.isWellFormed())) {
            throw new ValidationError('A GitHub comment slot must be a non-empty, well-formed string without NUL characters.');
        }

        opts.signal?.throwIfAborted();

        const controller = new AbortController();
        const timeout = new ChamviError({
            message: `GitHub did not answer within ${options.timeoutMs}ms.`,
            code: GITHUB_REQUEST_ERROR_CODE,
        });
        const timer = options.clock.setTimeout(() => controller.abort(timeout), options.timeoutMs);
        const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
        const slotKey = message.slot !== undefined ? `github:comment:${createHash('sha256').update(JSON.stringify([
            target.owner.toLowerCase(),
            target.repo.toLowerCase(),
            target.number,
            options.name,
            message.agent,
            message.slot,
        ])).digest('hex')}` : undefined;
        const owner = randomUUID();
        let acquired = false;

        try {
            try {
                if (slotKey) {
                    const acquisition = options.locks.acquire(slotKey, owner, options.timeoutMs * 2).then(async (taken) => {
                        // A cancelled caller may stop waiting before the store answers.
                        if (taken && signal.aborted) {
                            await options.locks.release(slotKey, owner);

                            return false;
                        }

                        acquired = taken;

                        return taken;
                    });

                    await untilAborted(acquisition, signal);
                    signal.throwIfAborted();

                    if (!acquired) {
                        throw new ChamviError({ message: 'GitHub persistent comment slot is busy; retry delivery.', code: GITHUB_REQUEST_ERROR_CODE });
                    }
                }

                const installationId = await untilAborted(installationOf(target, message, opts.trigger, options), signal);
                const octokit = await app.octokit(installationId);

                octokit.hook.before('request', (request) => {
                    request.request = { ...request.request, signal };
                });

                const deliveryKey = slotKey ? createHash('sha256').update(JSON.stringify([slotKey, message.runId, message.key])).digest('hex') : message.key;
                const marker = effectMarker(markerKey(deliveryKey));
                const stableMarker = slotKey ? `<!-- chamvi:comment=${slotKey.slice('github:comment:'.length)} -->` : undefined;
                const since = new Date(new Date(opts.trigger.receivedAt).getTime() - RECONCILE_SKEW_MS).toISOString();
                const route = {
                    owner: target.owner,
                    repo: target.repo,
                    issue_number: target.number,
                };
                const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
                    ...route,
                    ...(stableMarker ? {} : { since }),
                    per_page: 100,
                });

                const body = () => renderComment(message, {
                    mentions: options.mentions,
                    ...(options.approvalUrl ? { approvalUrl: options.approvalUrl } : {}),
                    marker: stableMarker ? `${marker}\n${stableMarker}` : marker,
                });

                for await (const { data } of pages) {
                    for (const comment of data) {
                        // Only renderer-owned footers identify comments, not markers quoted in a body.
                        if (!comment.body?.endsWith(`\n${stableMarker ?? marker}`)) {
                            continue;
                        }

                        const user = isObject(comment.user) ? comment.user : undefined;

                        if (user?.type === 'Bot' && isSameLogin(user.login, await app.botLogin())) {
                            if (stableMarker && !comment.body.endsWith(`\n${marker}\n${stableMarker}`)) {
                                await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
                                    owner: target.owner,
                                    repo: target.repo,
                                    comment_id: comment.id,
                                    body: body(),
                                });
                            }

                            return;
                        }
                    }
                }

                await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
                    ...route,
                    body: body(),
                });
            } finally {
                if (acquired && slotKey) {
                    await untilAborted(options.locks.release(slotKey, owner), signal);
                }
            }
        } catch (error) {
            if (opts.signal?.aborted) {
                throw opts.signal.reason;
            }

            if (error instanceof ChamviError) {
                throw error;
            }

            // Octokit wraps the abort reason as a 500 RequestError
            if (controller.signal.aborted) {
                throw timeout;
            }

            throw requestError(error);
        } finally {
            timer.clear();
        }
    };
}
