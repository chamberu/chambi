import{_ as n,o as a,c as e,a2 as p}from"./chunks/framework.Di-jvWLj.js";const h=JSON.parse('{"title":"@chamvi/http","description":"","frontmatter":{},"headers":[],"relativePath":"reference/http.md","filePath":"reference/http.md","lastUpdated":1793209247000}'),l={name:"reference/http.md"};function o(t,s,c,r,i,y){return a(),e("div",null,[...s[0]||(s[0]=[p(`<h1 id="chamvi-http" tabindex="-1">@chamvi/http <a class="header-anchor" href="#chamvi-http" aria-label="Permalink to &quot;@chamvi/http&quot;">​</a></h1><p>REST, SSE, MCP, the <code>http</code>, <code>mcp</code> and <code>webhook</code> channels and the <code>/channels/&lt;name&gt;</code> mount for chamvi agents, on routup. The public API of <code>packages/http/src/index.ts</code>.</p><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/http</span><span style="color:#E7C58C;"> @chamvi/core</span><span style="color:#E7C58C;"> --save</span></span></code></pre></div><p><code>@chamvi/core</code> is a peer dependency. See <a href="/guide/http">HTTP API &amp; MCP</a> for the behaviour.</p><h2 id="createhttpapp" tabindex="-1">createHttpApp <a class="header-anchor" href="#createhttpapp" aria-label="Permalink to &quot;createHttpApp&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createHttpApp(options: HttpAppOptions): App; </span><span style="color:#958A8B;">// routup App</span></span></code></pre></div><p>The store, the agents and the clock come from <code>engine</code> (<code>engine.store</code>, <code>engine.listAgents()</code>, <code>engine.clock</code>). The agents are read from the engine on every request, so an agent registered, replaced or removed at runtime gets (or loses) its routes, webhook subscriptions, <code>GET /agents</code> entry, schedules and MCP <code>run_&lt;agent&gt;</code> tool at once; a <code>run_&lt;agent&gt;</code> definition is built once per agent object, and one that fails for an agent registered after construction goes to <code>onError</code> and that tool is left out. <code>agents</code> narrows the served agents to the named ones, checked at construction: the others, also agents registered later, get no routes or MCP tools in this app (a mounted channel serves every agent subscribing to it), and a named agent removed from the engine answers 404. <code>agentIssues</code> lists agents that failed to load as <code>GET /agents</code> <code>issues</code>. <code>HttpRouteContext.agents</code> is read from the engine on every access. Throws <code>InvalidAgentDefinitionError</code> for a name in <code>agents</code> the engine lacks or that is given twice, an empty <code>auth</code> array and an invalid <code>routes</code> entry (a path that is not static, a duplicate method and path, a first segment of a built-in route such as <code>agents</code>, <code>runs</code> or <code>channels</code>, or the metrics path, all compared case-insensitively).</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CorsOptions = CorsPluginOptions;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RateLimitOptions = RateLimitPluginOptions;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A mounted channel&#39;s independent per-client HTTP request limit. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ChannelRateLimitOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    max: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Positive timer-safe milliseconds. Default: 60,000. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    windowMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PrometheusOptions = PrometheusPluginOptions;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** routup&#39;s trust-proxy input: a predicate, CIDRs, \`&#39;loopback&#39;\`, a hop count or a boolean. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> TrustProxyInput = NonNullable&lt;AppOptionsInput[</span><span style="color:#E7C58C;">&#39;trustProxy&#39;</span><span style="color:#E6DFDE;">]&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> McpOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    name?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    version?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxWaitSeconds?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpAppOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Its \`store\`, agents and \`clock\` serve every route. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    engine: Engine;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Names of the engine&#39;s agents to serve (routes, MCP tools, extra</span></span>
<span class="line"><span style="color:#958A8B;">     * routes), checked at construction; the others, also agents registered</span></span>
<span class="line"><span style="color:#958A8B;">     * later, are unknown to this app. A named agent removed from the engine</span></span>
<span class="line"><span style="color:#958A8B;">     * answers 404. Default: every agent the engine holds, at request time.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    agents?: string[];</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Agents that failed to load (e.g. from an agents folder), read per</span></span>
<span class="line"><span style="color:#958A8B;">     * \`GET /agents\` and listed as its \`issues\`. Default: none.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    agentIssues?: () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#FF7B84;"> readonly</span><span style="color:#E6DFDE;"> AgentIssue[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** One authenticator or a chain; the first principal wins. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    auth: Authenticator | Authenticator[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Prefix of every route, e.g. \`/api\`. Default: none. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    basePath?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Which proxies \`getRequestIP\` trusts (and so the rate-limit key). Default: none. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    trustProxy?: TrustProxyInput;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Fails \`/readyz\` once shutting down; the app ends its streams on shutdown. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    shutdown?: IShutdown;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Bytes a request body may have. Default: 1 MiB. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    bodyLimit?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stream?: {</span></span>
<span class="line"><span style="color:#958A8B;">        /** How often a stream polls the store for runs executing elsewhere. Default: 2 s. */</span></span>
<span class="line"><span style="color:#E6DFDE;">        pollMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">        /**</span></span>
<span class="line"><span style="color:#958A8B;">         * Open SSE run streams plus waiting MCP \`run_&lt;agent&gt;\` calls, per app</span></span>
<span class="line"><span style="color:#958A8B;">         * (a positive integer). Over it a stream answers 503 with</span></span>
<span class="line"><span style="color:#958A8B;">         * \`Retry-After\`, an MCP call answers without waiting. Default: 1000.</span></span>
<span class="line"><span style="color:#958A8B;">         */</span></span>
<span class="line"><span style="color:#E6DFDE;">        maxOpen?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    };</span></span>
<span class="line"><span style="color:#E6DFDE;">    mcp?: false | McpOptions;</span></span>
<span class="line"><span style="color:#958A8B;">    /** CORS is off unless given. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cors?: false | CorsOptions;</span></span>
<span class="line"><span style="color:#E6DFDE;">    rateLimit?: false | Partial&lt;RateLimitOptions&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Policies for mounted POST /channels/&lt;name&gt; paths (including subpaths).</span></span>
<span class="line"><span style="color:#958A8B;">     * An omitted name shares the general limit; false exempts the channel;</span></span>
<span class="line"><span style="color:#958A8B;">     * an explicit policy replaces it with a separate per-channel/client bucket,</span></span>
<span class="line"><span style="color:#958A8B;">     * also when rateLimit is false. Authentication and body limits are unchanged.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    channelRateLimits?: Record&lt;string, false | ChannelRateLimitOptions&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    metrics?: false | Partial&lt;PrometheusOptions&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** How long \`/readyz\` waits for the store. Default: 2 s. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readyTimeoutMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Receives 5xx causes and background failures. Default: \`console.error\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onError?: (error: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Extra routes other packages contribute (e.g. the dashboard), served under \`basePath\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    routes?: HttpRoute[];</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Channels to serve at \`POST /channels/&lt;name&gt;\` and below (e.g. the</span></span>
<span class="line"><span style="color:#958A8B;">     * webhook and GitHub channels), unauthenticated: each checks its own</span></span>
<span class="line"><span style="color:#958A8B;">     * credentials. Each needs an \`in\` and must be the object the engine holds</span></span>
<span class="line"><span style="color:#958A8B;">     * under its name, else InvalidAgentDefinitionError. Default: none.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    channels?: IChannel[];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p><code>channels</code> lists the channels mounted at <code>POST /channels/&lt;name&gt;</code> (each needs an <code>in</code> and must be the object the engine holds under its name, else <code>InvalidAgentDefinitionError</code>). <code>routes</code> takes extra routes from other packages, such as the dashboard of <code>@chamvi/ui</code>:</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpRouteMethod = </span><span style="color:#E7C58C;">&#39;GET&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;POST&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;PUT&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;PATCH&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;DELETE&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpRouteRequest = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** URL, method, headers and signal; without the body, which only readBody() reads. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    request: Request;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The raw body, at most \`bodyLimit\` bytes: 413 above it (content-length</span></span>
<span class="line"><span style="color:#958A8B;">     * refused unread, else drained like readJsonBody), 415 for a non-JSON</span></span>
<span class="line"><span style="color:#958A8B;">     * media type with a non-empty body; an empty body is a 0-length array.</span></span>
<span class="line"><span style="color:#958A8B;">     * Memoized: every call answers the same bytes (or the same error).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readBody(): Promise&lt;Uint8Array&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The path below the route&#39;s \`path\`: \`&#39;&#39;\` for \`path\` itself, else the raw</span></span>
<span class="line"><span style="color:#958A8B;">     * (still percent-encoded, case kept) rest starting with \`/\`, e.g.</span></span>
<span class="line"><span style="color:#958A8B;">     * \`/assets/app-1a2b.js\`; never the query. Only a \`prefix\` route sees more than \`&#39;&#39;\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    subpath: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpRouteResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Set on the response; a \`content-type\` here wins over the body&#39;s default. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    headers?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * A \`Uint8Array\` is sent as is (\`application/octet-stream\` unless</span></span>
<span class="line"><span style="color:#958A8B;">     * \`headers\` names a \`content-type\`); objects, arrays, numbers and booleans</span></span>
<span class="line"><span style="color:#958A8B;">     * as JSON, a string as \`text/plain\`; \`undefined\` or \`null\` answer an empty body.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    body?: unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpRouteContext = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    engine: Engine;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The agents the app serves, read from the engine on every access. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    agents: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> Agent[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">    onError: (error: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The app&#39;s \`basePath\` (\`&#39;&#39;\` by default), e.g. to build absolute links. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    basePath: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpRoute = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    method: HttpRouteMethod;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Static path under basePath (no &#39;:&#39; &#39;*&#39; &#39;{&#39;), e.g. &#39;/ui&#39;; also its metrics label. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** false: skipped by the app&#39;s rate limiter (callers that never retry, e.g. webhook senders). Default: limited. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    rateLimit?: false;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * true: the route also serves every path below \`path/\` (same method),</span></span>
<span class="line"><span style="color:#958A8B;">     * handing the rest as \`request.subpath\`; labelled \`&lt;path&gt;/*\` in metrics.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    prefix?: true;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Not authenticated by the app&#39;s authenticators: the route checks its own</span></span>
<span class="line"><span style="color:#958A8B;">     * credentials. Thrown @ebec/http and core errors render like any route&#39;s.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    handler: (request: HttpRouteRequest, ctx: HttpRouteContext) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;HttpRouteResult&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="channel-http-request-limits" tabindex="-1">Channel HTTP request limits <a class="header-anchor" href="#channel-http-request-limits" aria-label="Permalink to &quot;Channel HTTP request limits&quot;">​</a></h2><p><code>channelRateLimits?: Record&lt;string, false | ChannelRateLimitOptions&gt;</code> selects the HTTP intake policy for each mounted channel, without changing run execution capacity:</p><ul><li>An omitted entry inherits the general <code>rateLimit</code> bucket (default 300 requests per 60 seconds per client IP), shared with REST and other unconfigured channels.</li><li><code>{ max, windowMs? }</code> replaces that bucket for the channel with its own per-client bucket, separate from REST and other configured channels. <code>windowMs</code> defaults to 60,000. Explicit channel limits also work when the general <code>rateLimit</code> is <code>false</code>.</li><li><code>false</code> removes request limiting only for that channel&#39;s mounted <code>POST /channels/&lt;name&gt;</code> and subpaths. It does not disable authentication, signatures or body-size checks. Other methods and unknown channel paths do not gain the exemption.</li></ul><p>The keys must exactly name mounted input channels. <code>max</code> must be a positive safe integer; <code>windowMs</code> a positive integer no greater than 2,147,483,647. Invalid policies throw <code>InvalidAgentDefinitionError</code> before serving. Buckets are local to this HTTP app, not coordinated through the run store. Refusals remain JSON <code>429</code> responses with <code>Retry-After</code> and rate-limit headers.</p><p>The same options pass through <code>httpModule()</code> in <code>@chamvi/app</code>. See <a href="/deployment/github-app#bursts-and-http-intake">GitHub intake behind an ingress</a> for finite and disabled examples. <code>trustProxy</code> defaults to trusting no forwarded headers; restrict it to known proxy source addresses or CIDRs, never blindly trust arbitrary client headers.</p><h2 id="channels" tabindex="-1">Channels <a class="header-anchor" href="#channels" aria-label="Permalink to &quot;Channels&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> httpChannel(): IChannel;                                </span><span style="color:#958A8B;">// name &#39;http&#39;: REST runs; no in, no out</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> mcpChannel(): IChannel;                                 </span><span style="color:#958A8B;">// name &#39;mcp&#39;: MCP run_&lt;agent&gt; runs; no in, no out</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> webhookChannel(options: WebhookChannelOptions): WebhookChannel; </span><span style="color:#958A8B;">// in at /channels/&lt;name&gt;/&lt;agent&gt;&lt;path&gt;; on() bound to its name</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> readRequestBody(request: Request, options: ReadRequestBodyOptions): Promise&lt;Uint8Array&gt;; </span><span style="color:#958A8B;">// for a channel&#39;s in: 413 above options.limit</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> http: HttpSubscriber;       </span><span style="color:#958A8B;">// http.on({ schema? }): id &#39;http&#39;, at most one per agent</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> webhook: WebhookSubscriber; </span><span style="color:#958A8B;">// webhook.on(path, options?): id &#39;webhook:&lt;path&gt;&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> HTTP_CHANNEL_NAME: </span><span style="color:#E7C58C;">&#39;http&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> MCP_CHANNEL_NAME: </span><span style="color:#E7C58C;">&#39;mcp&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> WEBHOOK_CHANNEL_NAME: </span><span style="color:#E7C58C;">&#39;webhook&#39;</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ChannelRequest, IChannel } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Authenticator } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../auth/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { WebhookSubscriber } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../subscriptions/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WebhookChannelOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The channel name; default \`webhook\`. A second instance needs its own. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    name?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Who may deliver: the first principal wins (as the http app&#39;s \`auth\`),</span></span>
<span class="line"><span style="color:#958A8B;">     * and it needs \`agent:&lt;agent&gt;:run\`. Required, since the http app never</span></span>
<span class="line"><span style="color:#958A8B;">     * authenticates channel routes.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    auth: Authenticator | Authenticator[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Bytes a delivery may have (413 above). Default: 1 MiB, the http app&#39;s default. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    bodyLimit?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A webhook channel: \`in\` only, with \`on()\` bound to its name. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WebhookChannel = IChannel&lt;ChannelRequest, Response&gt; &amp; WebhookSubscriber;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A webhook delivery&#39;s target, parsed from the subpath; internal. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WebhookTarget = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Starts with \`/\`, the decoded segments joined with \`/\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ChannelSubscription } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { StandardSchemaV1 } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@standard-schema/spec&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpSubscriptionOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Shared-store execution cap for REST, UI and MCP starts; omitted or false adds no cap. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    concurrencyMaxRuns?: number | false;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Validates the payload of a REST, UI or MCP start. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    schema?: StandardSchemaV1;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Makes the \`http\` subscription (id \`http\`, at most one per agent). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpSubscriber = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    on(options?: HttpSubscriptionOptions): ChannelSubscription;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WebhookSubscriptionOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Shared-store execution cap within the agent; omitted or false adds no cap. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    concurrencyMaxRuns?: number | false;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Validates the delivered payload. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    schema?: StandardSchemaV1;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The run&#39;s idempotency key when the delivery has no \`Idempotency-Key\` header. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    idempotencyKey?: (payload: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> string | undefined;</span></span>
<span class="line"><span style="color:#E6DFDE;">    concurrencyKey?: (payload: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> string | undefined;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Makes webhook subscriptions for one channel name. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WebhookSubscriber = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`path\` starts with \`/\`; the subscription id is \`webhook:&lt;path&gt;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    on(path: string, options?: WebhookSubscriptionOptions): ChannelSubscription;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p>The engine refuses an <code>http.on()</code> subscription unless it holds <code>httpChannel()</code> (REST and MCP keep separate idempotency scopes through the two channel names), and a <code>webhook.on()</code> one unless it holds the webhook channel. <code>webhook.on()</code> throws <code>InvalidAgentDefinitionError</code> for a path that does not start with <code>/</code>. See <a href="/guide/http#channels">Channels</a>.</p><h2 id="authenticators" tabindex="-1">Authenticators <a class="header-anchor" href="#authenticators" aria-label="Permalink to &quot;Authenticators&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> Authenticator = (request: Request) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;Principal | undefined&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> staticTokens(options: StaticTokensOptions): Authenticator;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> authup(options: AuthupOptions): Authenticator;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> oidc(options: OidcOptions): Authenticator;</span></span></code></pre></div><p>An authenticator resolves <code>undefined</code> for a request it does not recognize and throws a 401 for credentials it rejects. <code>staticTokens</code> throws <code>InvalidAgentDefinitionError</code> for an empty <code>tokens</code> array, a token <code>value</code> shorter than 16 characters, a missing <code>id</code> or a <code>value</code> given twice; <code>oidc</code> for an empty <code>issuers</code> list, an issuer without <code>audience</code> or a missing <code>principal</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Permission } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;./constants.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PermissionName = </span><span style="color:#FF7B84;">typeof</span><span style="color:#E6DFDE;"> Permission[keyof </span><span style="color:#FF7B84;">typeof</span><span style="color:#E6DFDE;"> Permission];</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AgentAction = </span><span style="color:#E7C58C;">&#39;run&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;approve&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Principal = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    kind: </span><span style="color:#E7C58C;">&#39;token&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;authup&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;oidc&#39;</span><span style="color:#E6DFDE;"> | (string &amp; {});</span></span>
<span class="line"><span style="color:#958A8B;">    /** Granted permissions, e.g. \`agent:triage:run\`, \`run:read\` or \`*\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    permissions: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    claims?: Record&lt;string, unknown&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * Resolves \`undefined\` when the request carries no credentials it</span></span>
<span class="line"><span style="color:#958A8B;"> * recognizes, throws \`UnauthorizedError\` for credentials it rejects.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Authenticator = (request: Request) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;Principal | undefined&gt;;</span></span></code></pre></div><h2 id="permissions" tabindex="-1">Permissions <a class="header-anchor" href="#permissions" aria-label="Permalink to &quot;Permissions&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> Permission: {</span></span>
<span class="line"><span style="color:#E6DFDE;">    ALL: </span><span style="color:#E7C58C;">&#39;*&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    RUN_READ: </span><span style="color:#E7C58C;">&#39;run:read&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    RUN_CANCEL: </span><span style="color:#E7C58C;">&#39;run:cancel&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    STATE_READ: </span><span style="color:#E7C58C;">&#39;state:read&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    STATE_WRITE: </span><span style="color:#E7C58C;">&#39;state:write&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> agentPermission(agent: string, action: </span><span style="color:#E7C58C;">&#39;run&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;approve&#39;</span><span style="color:#E6DFDE;">): string; </span><span style="color:#958A8B;">// agent:&lt;agent&gt;:&lt;action&gt;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertMcpRunTool(agent: Agent): void; </span><span style="color:#958A8B;">// throws InvalidAgentDefinitionError like createHttpApp</span></span></code></pre></div><p><code>assertMcpRunTool</code> builds the agent&#39;s <code>run_&lt;agent&gt;</code> MCP tool definition and throws what <code>createHttpApp</code> would throw for it (a tool name above 64 characters, a payload schema MCP cannot compile); the app runs it on every folder agent before registering it. <code>createHttpApp</code> reports a folder agent&#39;s failure (one the engine holds at a revision) to <code>onError</code> and skips its tool instead of throwing.</p><p>Matching uses core&#39;s <a href="/reference/#permissions"><code>hasPermission(principal.permissions, permission)</code></a>: true for a granted <code>*</code>, or for a grant with the same number of <code>:</code> segments whose every segment is equal or <code>*</code>.</p><h2 id="createshutdown" tabindex="-1">createShutdown <a class="header-anchor" href="#createshutdown" aria-label="Permalink to &quot;createShutdown&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createShutdown(options: ShutdownOptions): IShutdown;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS: </span><span style="color:#E7C58C;">30_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> DEFAULT_SHUTDOWN_CLOSE_TIMEOUT_MS: </span><span style="color:#E7C58C;">5_000</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Engine } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IShutdown {</span></span>
<span class="line"><span style="color:#958A8B;">    /** True from the first \`shutdown()\` call on; \`/readyz\` then fails. */</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> shuttingDown: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Runs \`fn\` during the shutdown, in the order added, after readiness</span></span>
<span class="line"><span style="color:#958A8B;">     * failed and before the server closes; returns an unsubscribe.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onShutdown(fn: () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void | Promise&lt;void&gt;): () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Idempotent: every call returns the same promise. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    shutdown(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ShutdownOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Drained on shutdown; its \`clock\` times the delays. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    engine: Engine;</span></span>
<span class="line"><span style="color:#958A8B;">    /** srvx \`Server\` (pass \`gracefulShutdown: false\` to \`serve\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    server?: { close(closeActiveConnections?: boolean): Promise&lt;void&gt; };</span></span>
<span class="line"><span style="color:#958A8B;">    /** Time for load balancers to see the failing readiness. Default 0. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readinessDelayMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default 30 s. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    drainTimeoutMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Wait for open connections after the drain, then close them. Default 5 s. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    closeTimeoutMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`console.error\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onError?: (error: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="wire-types" tabindex="-1">Wire types <a class="header-anchor" href="#wire-types" aria-label="Permalink to &quot;Wire types&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> InvokerView = Omit&lt;Invoker, </span><span style="color:#E7C58C;">&#39;permissions&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> RunView = Omit&lt;Run, </span><span style="color:#E7C58C;">&#39;claim&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;trigger&#39;</span><span style="color:#E6DFDE;">&gt; &amp; {</span></span>
<span class="line"><span style="color:#E6DFDE;">    trigger: Omit&lt;TriggerEnvelope, </span><span style="color:#E7C58C;">&#39;invoker&#39;</span><span style="color:#E6DFDE;">&gt; &amp; { invoker?: InvokerView };</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> RunSummary = Pick&lt;Run, </span><span style="color:#E7C58C;">&#39;id&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;agent&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;status&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;createdAt&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;finishedAt&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;error&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> RunToolResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: RunStatusLiteral;</span></span>
<span class="line"><span style="color:#E6DFDE;">    deduplicated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    output?: unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">    error?: { code: string; message: string };</span></span>
<span class="line"><span style="color:#E6DFDE;">    waiting?: {</span></span>
<span class="line"><span style="color:#E6DFDE;">        toolName: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        title: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        body?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        options?: ApprovalOption[]; </span><span style="color:#958A8B;">// the choices to answer with approve_run&#39;s selected</span></span>
<span class="line"><span style="color:#E6DFDE;">        multiple?: boolean; </span><span style="color:#958A8B;">// true when several options may be selected</span></span>
<span class="line"><span style="color:#E6DFDE;">        expiresAt: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    };</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> ApproveBody = { </span><span style="color:#958A8B;">// POST /runs/:id/approve; approve_run takes the same fields plus runId</span></span>
<span class="line"><span style="color:#E6DFDE;">    approvalId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    approved: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    reason?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    selected?: string[]; </span><span style="color:#958A8B;">// the chosen option ids of a wait point with options, none on a denial</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p><code>selected</code> follows <code>engine.approve()</code>&#39;s rules (see <a href="/guide/approvals">Approvals</a> and <a href="/guide/http">HTTP</a>): a selection that does not fit the wait point is <code>400 validation_error</code>.</p><p><code>GET /agents</code> answers <code>{ data: AgentSummary[], issues: AgentIssue[] }</code>, <code>GET /schedules</code> <code>{ data: ScheduleSummary[] }</code>:</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/** An agent as \`GET /agents\` lists it. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AgentSummary = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The agent&#39;s subscriptions: the channel name and the subscription id;</span></span>
<span class="line"><span style="color:#958A8B;">     * \`hook\` is the ready-made path of a subscription to a webhook channel</span></span>
<span class="line"><span style="color:#958A8B;">     * this app mounts.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    channels: Array&lt;{</span></span>
<span class="line"><span style="color:#E6DFDE;">        channel: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        id: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        hook?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    budget: Budget;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Declared state collections. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    state: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** An agent that failed to load, as \`GET /agents\` lists it next to the agents. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AgentIssue = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    message: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    at: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A cron subscription as \`GET /schedules\` lists it (definitions only, not scheduler health). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ScheduleSummary = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The cron channel&#39;s name. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    channel: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The subscription id. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    trigger: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expression: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    timezone?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    overlap: ScheduleOverlap;</span></span>
<span class="line"><span style="color:#958A8B;">    /** ISO time of the next fire after now. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    nextAt: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div>`,36)])])}const E=n(l,[["render",o]]);export{h as __pageData,E as default};
