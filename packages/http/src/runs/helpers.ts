/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    APPROVAL_OPTIONS_MAX,
    ArtifactNotFoundError,
    RunNotFoundError,
    RunStatus,
    hasPermission,
} from '@chamvi/core';
import type {
    Agent,
    Artifact,
    ArtifactInput,
    ChannelSubscription,
    Invoker,
    Run,
    RunStatusLiteral,
    Step,
} from '@chamvi/core';
import { BadRequestError, ForbiddenError, NotFoundError } from '@ebec/http';
import { defineSchema } from '@rapiq/core';
import type { IFilter } from '@rapiq/core';
import { parseFilterScalar } from '@rapiq/parser-simple';
import { isObject } from 'smob';
import { Container } from 'validup';
import { agentPermission } from '../auth/module.ts';
import { Permission } from '../auth/constants.ts';
import type { Principal } from '../auth/types.ts';
import { DEFAULT_PAGE_LIMIT } from '../app/constants.ts';
import { HTTP_CHANNEL_NAME } from '../channels/constants.ts';
import type { HttpContext } from '../app/types.ts';
import { decodeQuery } from '../request/helpers.ts';
import {
    isArrayOf,
    isBase64,
    isBoolean,
    isDefined,
    isMediaType,
    isString,
    isStringArray,
} from '../request/validators.ts';
import { KEY_MAX_LENGTH } from '../request/constants.ts';
import {
    APPROVAL_ID_MAX_LENGTH,
    APPROVAL_OPTION_ID_MAX_LENGTH,
    APPROVAL_REASON_MAX_LENGTH,
    ATTACHMENT_FILENAME_MAX_LENGTH,
    MAX_ATTACHMENTS,
} from './constants.ts';
import type {
    ApproveBody,
    InvokerView,
    RunListQuery,
    RunView,
    StartRunBody,
} from './types.ts';

/** An invoker without its `permissions`: a reader must not learn another principal's grants. */
function viewInvoker(invoker: Invoker): InvokerView {
    return {
        id: invoker.id,
        kind: invoker.kind,
        ...(invoker.name !== undefined ? { name: invoker.name } : {}),
    };
}

/**
 * Drops the internal claim, conversation binding and invoker permissions.
 */
export function serializeRun(run: Run): RunView {
    const view = { ...run };
    delete view.claim;
    delete view.conversation;
    return {
        ...view,
        trigger: run.trigger.invoker ? { ...run.trigger, invoker: viewInvoker(run.trigger.invoker) } : run.trigger,
    };
}

/** A step as it leaves the package: a `wait` step's approver without its `permissions`. */
export function serializeStep(step: Step): Step {
    if (step.kind !== 'wait' || !isObject(step.output)) return step;
    const { approver } = step.output as { approver?: unknown };
    if (!isObject(approver)) return step;
    return { ...step, output: { ...step.output, approver: viewInvoker(approver as Invoker) } };
}

/** `run:read`, or `agent:<run.agent>:run`. */
export function canReadRun(principal: Principal, run: Run): boolean {
    return hasPermission(principal.permissions, Permission.RUN_READ) ||
        hasPermission(principal.permissions, agentPermission(run.agent, 'run'));
}

/** The run, once the principal may read it: 404, then 403. */
export async function loadReadableRun(ctx: HttpContext, principal: Principal, id: string): Promise<Run> {
    const run = await ctx.stores.runs.getRun(id);
    if (!run) throw new RunNotFoundError(id);
    if (!canReadRun(principal, run)) {
        throw new ForbiddenError({ message: `Missing permission "${Permission.RUN_READ}".` });
    }
    return run;
}

/**
 * 403 unless the principal may list runs: `run:read`, or a filter to one
 * agent it may run (one store query keeps `total` and paging exact).
 */
export function assertCanListRuns(principal: Principal, agent: string | undefined): void {
    if (hasPermission(principal.permissions, Permission.RUN_READ)) return;
    if (agent !== undefined && hasPermission(principal.permissions, agentPermission(agent, 'run'))) return;
    throw new ForbiddenError({ message: `Missing permission "${Permission.RUN_READ}".` });
}

/** The agent's `http.on()` subscription, else 404. */
export function requireHttpSubscription(agent: Agent): ChannelSubscription {
    const subscription = findHttpSubscription(agent);
    if (!subscription) throw new NotFoundError({ message: `Agent "${agent.name}" has no http subscription.` });
    return subscription;
}

/** The agent's subscription to the `http` channel (REST and MCP starts), if any. */
export function findHttpSubscription(agent: Agent): ChannelSubscription | undefined {
    return agent.definition.channels?.find((subscription) => subscription.channel === HTTP_CHANNEL_NAME);
}

export function createStartRunContainer(): Container<StartRunBody> {
    const container = new Container<StartRunBody>();
    container.mount('payload', { optional: true }, isDefined());
    container.mount('idempotencyKey', { optional: true }, isString({ min: 1, max: KEY_MAX_LENGTH }));
    container.mount('address', { optional: true }, isString({ min: 1, max: KEY_MAX_LENGTH }));
    container.mount('attachments', { optional: true }, isArrayOf(createAttachmentContainer(), { max: MAX_ATTACHMENTS }));
    return container;
}

/** One attachment; unknown keys are dropped. */
function createAttachmentContainer(): Container<ArtifactInput> {
    const container = new Container<ArtifactInput>();
    container.mount('mediaType', isMediaType());
    container.mount('filename', { optional: true }, isString({ min: 1, max: ATTACHMENT_FILENAME_MAX_LENGTH }));
    container.mount('data', isBase64());
    return container;
}

/** An artifact of `run` with its bytes; ArtifactNotFoundError (404) for an unknown id or another run's artifact. */
export async function loadRunArtifact(ctx: HttpContext, run: Run, id: string): Promise<{ artifact: Artifact; data: Uint8Array }> {
    const artifact = await ctx.stores.artifacts.getArtifact(id);
    if (!artifact || artifact.runId !== run.id) throw new ArtifactNotFoundError(id);
    const data = await ctx.stores.artifacts.readArtifact(id);
    if (!data) throw new ArtifactNotFoundError(id);
    return { artifact, data };
}

/** The bytes as a response body; a view over a SharedArrayBuffer is copied (a body needs an ArrayBuffer). */
export function toBody(data: Uint8Array): Uint8Array<ArrayBuffer> {
    return data.buffer instanceof ArrayBuffer ? data as Uint8Array<ArrayBuffer> : new Uint8Array(data);
}

/** A quoted-string fallback: printable ASCII only, without `"` and `\`. */
function asciiFilename(filename: string): string {
    return filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
}

/** RFC 5987 `ext-value` characters: what encodeURIComponent leaves, minus `'()*`. */
function encodeRfc5987(value: string): string {
    return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `attachment`, with `filename` and an RFC 5987 `filename*` when the artifact has a filename. */
export function contentDisposition(filename: string | undefined): string {
    if (filename === undefined) return 'attachment';
    return `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

const RUN_LIST_SCHEMA = defineSchema({
    filters: { allowed: ['agent', 'status'] },
    sorts: { allowed: ['createdAt'] },
    throwOnFailure: true,
});

const RUN_STATUSES = new Set<string>(Object.values(RunStatus));

/**
 * The wire is untyped: rapiq coerces `123`, `007`, `true` or `null` to a
 * scalar, even quoted. Such a value maps back to the registered agent
 * whose name coerces to it; an unregistered one reads in canonical form.
 */
function readAgentFilter(filter: IFilter, agentNames: Iterable<string>): string {
    const { value } = filter;
    if (filter.operator !== 'eq' || Array.isArray(value) || isObject(value)) {
        throw new BadRequestError({ message: 'filter[agent] takes one agent name.' });
    }
    if (typeof value === 'string') return value;

    const matches = [...agentNames].filter((name) => parseFilterScalar(name) === value);
    if (matches.length > 1) {
        throw new BadRequestError({ message: 'filter[agent] matches more than one agent; the query string cannot tell them apart.' });
    }
    return matches[0] ?? String(value);
}

function readStatusFilter(filter: IFilter): RunStatusLiteral[] {
    let values: unknown[] | undefined;
    if (filter.operator === 'eq') values = [filter.value];
    else if (filter.operator === 'in' && Array.isArray(filter.value)) values = filter.value;
    if (!values || values.some((value) => !(typeof value === 'string' && RUN_STATUSES.has(value)))) {
        throw new BadRequestError({ message: 'filter[status] takes run statuses.' });
    }
    return values as RunStatusLiteral[];
}

/**
 * `GET /runs` query: one agent, statuses, a page, `sort=createdAt` only.
 * `agentNames` (the app's agents) resolve an agent name the wire coerced.
 */
export function parseRunListQuery(searchParams: URLSearchParams, agentNames: Iterable<string> = []): RunListQuery {
    const decoded = decodeQuery(searchParams, RUN_LIST_SCHEMA);

    const seen = new Set<string>();
    const query: RunListQuery = {
        limit: decoded.limit ?? DEFAULT_PAGE_LIMIT,
        offset: decoded.offset ?? 0,
        order: 'asc',
    };
    for (const filter of decoded.filters) {
        if (seen.has(filter.field)) {
            throw new BadRequestError({ message: `filter[${filter.field}] may be given once.` });
        }
        seen.add(filter.field);
        if (filter.field === 'agent') query.agent = readAgentFilter(filter, agentNames);
        else query.status = readStatusFilter(filter);
    }

    const [sort, ...others] = decoded.sorts;
    if (others.length > 0 || (sort && sort.name !== 'createdAt')) {
        throw new BadRequestError({ message: 'Only sort=createdAt or sort=-createdAt is supported.' });
    }
    if (sort?.operator === 'DESC') query.order = 'desc';

    return query;
}

export function createApproveContainer(): Container<ApproveBody> {
    const container = new Container<ApproveBody>();
    container.mount('approvalId', isString({ min: 1, max: APPROVAL_ID_MAX_LENGTH }));
    container.mount('approved', isBoolean());
    container.mount('reason', { optional: true }, isString({ max: APPROVAL_REASON_MAX_LENGTH }));
    container.mount(
        'selected',
        { optional: true },
        isStringArray({ max: APPROVAL_OPTIONS_MAX, item: { min: 1, max: APPROVAL_OPTION_ID_MAX_LENGTH } }),
    );
    return container;
}

/**
 * A run the principal may answer approvals of: 404 for a missing run (no
 * read permission needed), 403 without `agent:<agent>:approve`.
 */
export async function loadApprovableRun(ctx: HttpContext, principal: Principal, id: string): Promise<Run> {
    const run = await ctx.stores.runs.getRun(id);
    if (!run) throw new RunNotFoundError(id);
    assertCanApprove(principal, run);
    return run;
}

function assertCanApprove(principal: Principal, run: Run): void {
    const permission = agentPermission(run.agent, 'approve');
    if (!hasPermission(principal.permissions, permission)) {
        throw new ForbiddenError({ message: `Missing permission "${permission}".` });
    }
}
