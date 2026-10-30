/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Agent,
    Engine,
    IChannel,
    IClock,
    IStore,
} from '@chamvi/core';
import type { Options as CorsPluginOptions } from '@routup/cors';
import type { Options as PrometheusPluginOptions } from '@routup/prometheus';
import type { Options as RateLimitPluginOptions } from '@routup/rate-limit';
import type { AppOptionsInput } from 'routup';
import type { AgentIssue } from '../agents/types.ts';
import type { Authenticator } from '../auth/types.ts';
import type { IShutdown } from '../shutdown/types.ts';

// #region options
export type CorsOptions = CorsPluginOptions;

export type RateLimitOptions = RateLimitPluginOptions;

/** A mounted channel's independent per-client HTTP request limit. */
export type ChannelRateLimitOptions = {
    max: number;
    /** Positive timer-safe milliseconds. Default: 60,000. */
    windowMs?: number;
};

export type PrometheusOptions = PrometheusPluginOptions;

/** routup's trust-proxy input: a predicate, CIDRs, `'loopback'`, a hop count or a boolean. */
export type TrustProxyInput = NonNullable<AppOptionsInput['trustProxy']>;

export type McpOptions = {
    name?: string;
    version?: string;
    maxWaitSeconds?: number;
};

export type HttpAppOptions = {
    /** Its `store`, agents and `clock` serve every route. */
    engine: Engine;
    /**
     * Names of the engine's agents to serve (routes, MCP tools, extra
     * routes), checked at construction; the others, also agents registered
     * later, are unknown to this app. A named agent removed from the engine
     * answers 404. Default: every agent the engine holds, at request time.
     */
    agents?: string[];
    /**
     * Agents that failed to load (e.g. from an agents folder), read per
     * `GET /agents` and listed as its `issues`. Default: none.
     */
    agentIssues?: () => readonly AgentIssue[];
    /** One authenticator or a chain; the first principal wins. */
    auth: Authenticator | Authenticator[];
    /** Prefix of every route, e.g. `/api`. Default: none. */
    basePath?: string;
    /** Which proxies `getRequestIP` trusts (and so the rate-limit key). Default: none. */
    trustProxy?: TrustProxyInput;
    /** Fails `/readyz` once shutting down; the app ends its streams on shutdown. */
    shutdown?: IShutdown;
    /** Bytes a request body may have. Default: 1 MiB. */
    bodyLimit?: number;
    stream?: {
        /** How often a stream polls the store for runs executing elsewhere. Default: 2 s. */
        pollMs?: number;
        /**
         * Open SSE run streams plus waiting MCP `run_<agent>` calls, per app
         * (a positive integer). Over it a stream answers 503 with
         * `Retry-After`, an MCP call answers without waiting. Default: 1000.
         */
        maxOpen?: number;
    };
    mcp?: false | McpOptions;
    /** CORS is off unless given. */
    cors?: false | CorsOptions;
    rateLimit?: false | Partial<RateLimitOptions>;
    /**
     * Policies for mounted POST /channels/<name> paths (including subpaths).
     * An omitted name shares the general limit; false exempts the channel;
     * an explicit policy replaces it with a separate per-channel/client bucket,
     * also when rateLimit is false. Authentication and body limits are unchanged.
     */
    channelRateLimits?: Record<string, false | ChannelRateLimitOptions>;
    metrics?: false | Partial<PrometheusOptions>;
    /** How long `/readyz` waits for the store. Default: 2 s. */
    readyTimeoutMs?: number;
    /** Receives 5xx causes and background failures. Default: `console.error`. */
    onError?: (error: unknown) => void;
    /** Extra routes other packages contribute (e.g. the dashboard), served under `basePath`. */
    routes?: HttpRoute[];
    /**
     * Channels to serve at `POST /channels/<name>` and below (e.g. the
     * webhook and GitHub channels), unauthenticated: each checks its own
     * credentials. Each needs an `in` and must be the object the engine holds
     * under its name, else InvalidAgentDefinitionError. Default: none.
     */
    channels?: IChannel[];
};

// #endregion options

// #region routes
export type HttpRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HttpRouteRequest = {
    /** URL, method, headers and signal; without the body, which only readBody() reads. */
    request: Request;
    /**
     * The raw body, at most `bodyLimit` bytes: 413 above it (content-length
     * refused unread, else drained like readJsonBody), 415 for a non-JSON
     * media type with a non-empty body; an empty body is a 0-length array.
     * Memoized: every call answers the same bytes (or the same error).
     */
    readBody(): Promise<Uint8Array>;
    /**
     * The path below the route's `path`: `''` for `path` itself, else the raw
     * (still percent-encoded, case kept) rest starting with `/`, e.g.
     * `/assets/app-1a2b.js`; never the query. Only a `prefix` route sees more than `''`.
     */
    subpath: string;
};

export type HttpRouteResult = {
    status: number;
    /** Set on the response; a `content-type` here wins over the body's default. */
    headers?: Record<string, string>;
    /**
     * A `Uint8Array` is sent as is (`application/octet-stream` unless
     * `headers` names a `content-type`); objects, arrays, numbers and booleans
     * as JSON, a string as `text/plain`; `undefined` or `null` answer an empty body.
     */
    body?: unknown;
};

export type HttpRouteContext = {
    engine: Engine;
    /** The agents the app serves, read from the engine on every access. */
    agents: readonly Agent[];
    clock: IClock;
    onError: (error: unknown) => void;
    /** The app's `basePath` (`''` by default), e.g. to build absolute links. */
    basePath: string;
};

export type HttpRoute = {
    method: HttpRouteMethod;
    /** Static path under basePath (no ':' '*' '{'), e.g. '/ui'; also its metrics label. */
    path: string;
    /** false: skipped by the app's rate limiter (callers that never retry, e.g. webhook senders). Default: limited. */
    rateLimit?: false;
    /**
     * true: the route also serves every path below `path/` (same method),
     * handing the rest as `request.subpath`; labelled `<path>/*` in metrics.
     */
    prefix?: true;
    /**
     * Not authenticated by the app's authenticators: the route checks its own
     * credentials. Thrown @ebec/http and core errors render like any route's.
     */
    handler: (request: HttpRouteRequest, ctx: HttpRouteContext) => Promise<HttpRouteResult>;
};

// #endregion routes

/** The app's live view of the engine's agents (filtered by `HttpAppOptions.agents`); internal. */
export type HttpAgents = {
    get(name: string): Agent | undefined;
    /** In registration order, a new array. */
    list(): Agent[];
    names(): string[];
};

/** Shared by every route module; internal. */
export type HttpContext = {
    engine: Engine;
    store: IStore;
    agents: HttpAgents;
    /** Agents that failed to load, as `GET /agents` lists them. */
    agentIssues: () => AgentIssue[];
    authenticators: Authenticator[];
    basePath: string;
    bodyLimit: number;
    streamPollMs: number;
    /** Cap on `openStreams`. */
    maxOpenStreams: number;
    /** Open SSE run streams plus waiting MCP `run_<agent>` calls. */
    openStreams: number;
    readyTimeoutMs: number;
    clock: IClock;
    shutdown?: IShutdown;
    /** Ends open streams and closes handlers on shutdown. */
    closers: Set<() => void | Promise<void>>;
    /** Set once the shutdown callback runs the closers: no new streams or MCP requests. */
    closed: boolean;
    /** Extra routes, validated in `buildContext`. */
    routes: HttpRoute[];
    /** Mounted channels, validated in `buildContext`. */
    channels: IChannel[];
    onError: (error: unknown) => void;
};
