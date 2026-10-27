import{_ as n,o as a,c as e,a2 as l}from"./chunks/framework.Di-jvWLj.js";const h=JSON.parse('{"title":"@chamvi/channel-cron","description":"","frontmatter":{},"headers":[],"relativePath":"reference/channel-cron.md","filePath":"reference/channel-cron.md","lastUpdated":1793100831000}'),o={name:"reference/channel-cron.md"};function p(c,s,t,r,i,d){return a(),e("div",null,[...s[0]||(s[0]=[l(`<h1 id="chamvi-channel-cron" tabindex="-1">@chamvi/channel-cron <a class="header-anchor" href="#chamvi-channel-cron" aria-label="Permalink to &quot;@chamvi/channel-cron&quot;">​</a></h1><p>The cron channel: fires <code>cron.on()</code> subscriptions once per tick across replicas, on hubwire. The public API of <code>packages/channel-cron/src/index.ts</code>.</p><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/channel-cron</span><span style="color:#E7C58C;"> @chamvi/core</span><span style="color:#E7C58C;"> --save</span></span></code></pre></div><p><code>@chamvi/core</code> is a peer dependency. See <a href="/guide/scheduler">Cron Scheduling</a> for the behaviour.</p><h2 id="cronchannel" tabindex="-1">cronChannel <a class="header-anchor" href="#cronchannel" aria-label="Permalink to &quot;cronChannel&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> cronChannel(options?: CronChannelOptions): CronChannel; </span><span style="color:#958A8B;">// IChannel with start/stop, plus on() bound to its name</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CRON_CHANNEL_NAME: </span><span style="color:#E7C58C;">&#39;cron&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> SCHEDULE_LOCK_TTL_MS: </span><span style="color:#E7C58C;">600_000</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IChannel } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { CronSubscriber } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../subscription/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronChannelErrorContext = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The subscription id. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    subscription: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronChannelOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The channel name; default \`cron\`. A second instance needs its own. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    name?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Owner of the tick locks. Default \`\${hostname()}-\${pid}\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    owner?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * How long a tick&#39;s lock key is held; a tick whose timer fires this late or</span></span>
<span class="line"><span style="color:#958A8B;">     * later is skipped. Default SCHEDULE_LOCK_TTL_MS.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    lockTtlMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Receives a failing tick (lock store, overlap check or dispatch) and a</span></span>
<span class="line"><span style="color:#958A8B;">     * folder agent&#39;s subscription hubwire cannot schedule. Ticks another</span></span>
<span class="line"><span style="color:#958A8B;">     * replica won are not errors. Default console.error(&#39;[chamvi]&#39;, error, ctx).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onError?: (error: unknown, ctx: CronChannelErrorContext) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The cron channel: background inbound only (no \`in\`, no \`out\`), with \`on()\` bound to its name. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronChannel = IChannel &amp; CronSubscriber;</span></span></code></pre></div><p><code>engine.start()</code> starts the channel: it schedules the cron subscriptions <strong>of this channel</strong> (<code>subscription.channel === name</code>) of <code>engine.listAgents()</code> and locks over <code>engine.store</code>. A code agent&#39;s subscription the scheduler cannot use (expression, timezone) fails <code>engine.start()</code> with <code>InvalidAgentDefinitionError</code>; a folder agent&#39;s (one the engine holds at a revision) goes to <code>onError</code> instead and leaves that agent unscheduled. An invalid <code>name</code> (the agent-name rule), an empty <code>owner</code> or a <code>lockTtlMs</code> that is no positive integer throws <code>InvalidAgentDefinitionError</code> when <code>cronChannel()</code> is called.</p><p>It follows the engine&#39;s <code>agents.changed</code> events: an added agent is scheduled, a replaced one rescheduled, a removed one unscheduled. A replacement whose cron subscription hubwire cannot schedule goes to <code>onError</code> and leaves that agent unscheduled. <code>stop()</code> (called first by <code>engine.drain()</code> and <code>engine.stop()</code>) stops following and waits for the ticks in flight, also of replaced and removed agents.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertSchedulable(agent: Agent, channel?: string): void; </span><span style="color:#958A8B;">// channel default &#39;cron&#39;</span></span></code></pre></div><p>Throws the same error as the start for an agent&#39;s subscriptions of <code>channel</code>, without scheduling anything; the app runs it on every folder agent before registering it.</p><h2 id="cron-on" tabindex="-1">cron.on <a class="header-anchor" href="#cron-on" aria-label="Permalink to &quot;cron.on&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> cron: CronSubscriber; </span><span style="color:#958A8B;">// cron.on(expression, options?): a subscription of the channel named &#39;cron&#39;</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ChannelSubscription } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What a tick does while a run of the same subscription is active. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> OverlapPolicy = </span><span style="color:#E7C58C;">&#39;skip&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;queue-one&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;allow&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronSubscriptionOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** IANA zone; default the process&#39;s local zone. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    timezone?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`skip\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    overlap?: OverlapPolicy;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The run&#39;s payload; default \`{ scheduledAt: &#39;&lt;ISO&gt;&#39; }\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    payload?: unknown;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The subscription id, unique per agent; default \`cron:&lt;expression&gt;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    id?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Makes cron subscriptions for one channel name. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronSubscriber = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    on(expression: string, options?: CronSubscriptionOptions): ChannelSubscription;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p>Throws <code>InvalidAgentDefinitionError</code> for an expression cron-parser refuses, an unknown timezone, an unknown <code>overlap</code> or an empty <code>id</code>. The id defaults to <code>cron:&lt;expression&gt;</code>.</p><h2 id="runjob" tabindex="-1">runJob <a class="header-anchor" href="#runjob" aria-label="Permalink to &quot;runJob&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> runJob(opts: RunJobOptions): Promise&lt;RunJobResult&gt;;</span></span></code></pre></div><p>Starts the engine with <code>start({ channels: false })</code>. Rejects with <code>InvalidAgentDefinitionError</code> when the subscription is missing or ambiguous, or the engine holds no cron channel for it.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    Agent,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Engine,</span></span>
<span class="line"><span style="color:#E6DFDE;">    RunStatusLiteral,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RunJobOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Not started yet; runJob starts it without channels and drains it, also</span></span>
<span class="line"><span style="color:#958A8B;">     * when the tick is skipped. It holds the subscription&#39;s cron channel. Its store is polled and its clock gives scheduledAt and drives</span></span>
<span class="line"><span style="color:#958A8B;">     * the poll.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    engine: Engine;</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: Agent;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Cron subscription id; optional when the agent has exactly one</span></span>
<span class="line"><span style="color:#958A8B;">     * subscription of a cron channel the engine holds.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    subscription?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Fallback poll of engine.getRun, default 1_000. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    pollMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Passed to engine.drain, default 30_000. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    drainTimeoutMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Stops the job: already aborted, nothing is fired and the engine is never</span></span>
<span class="line"><span style="color:#958A8B;">     * started (\`skipped\`); aborted while waiting, the wait ends and the engine</span></span>
<span class="line"><span style="color:#958A8B;">     * drains, and the result is the run as stored after the drain. The abort</span></span>
<span class="line"><span style="color:#958A8B;">     * reason is never thrown.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RunJobResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The run&#39;s status when the job returned: \`completed\`, \`failed\`,</span></span>
<span class="line"><span style="color:#958A8B;">     * \`cancelled\`, \`waiting\`, \`queued\` (behind a run of its concurrency key</span></span>
<span class="line"><span style="color:#958A8B;">     * that waits for an approval), or &#39;skipped&#39; (overlap, or a signal</span></span>
<span class="line"><span style="color:#958A8B;">     * aborted before the call). After an abort while waiting: the status the</span></span>
<span class="line"><span style="color:#958A8B;">     * drain left, usually \`interrupted\`, or \`running\` when the drain timed out</span></span>
<span class="line"><span style="color:#958A8B;">     * before the run was marked.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: RunStatusLiteral | </span><span style="color:#E7C58C;">&#39;skipped&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#958A8B;">    /** 1 for failed and cancelled; 0 otherwise (an interrupted run is resumed by a replica). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode: </span><span style="color:#E7C58C;">0</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">1</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="building-blocks" tabindex="-1">Building blocks <a class="header-anchor" href="#building-blocks" aria-label="Permalink to &quot;Building blocks&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> fireCronSubscription(ctx: CronTickContext): Promise&lt;CronTickResult&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> readCronOptions(agent: Agent, subscription: ChannelSubscription): CronOptions;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createStoreScheduleLock(store: ILockStore, owner: string): IScheduleLock;</span></span></code></pre></div><p><code>fireCronSubscription</code> is one tick (overlap check and dispatch) for an explicit <code>scheduledAt</code>; the channel and <code>runJob</code> both call it. <code>createStoreScheduleLock</code> adapts core&#39;s <code>ILockStore</code> to hubwire&#39;s <code>IScheduleLock</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    Agent,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ChannelContext,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ChannelSubscription,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Engine,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { OverlapPolicy } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../subscription/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The options \`cron.on()\` stores on a subscription, read back and checked. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    expression: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    timezone?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    overlap: OverlapPolicy;</span></span>
<span class="line"><span style="color:#E6DFDE;">    payload?: unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronTickContext = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    engine: Engine;</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: Agent;</span></span>
<span class="line"><span style="color:#E6DFDE;">    subscription: ChannelSubscription;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The tick&#39;s planned fire time; forms the idempotency key. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    scheduledAt: Date;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The channel&#39;s dispatch (sets the channel name itself). Default</span></span>
<span class="line"><span style="color:#958A8B;">     * engine.dispatch with \`channel\` = the subscription&#39;s channel.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    dispatch?: ChannelContext[</span><span style="color:#E7C58C;">&#39;dispatch&#39;</span><span style="color:#E6DFDE;">];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronTickDispatched = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    dispatched: true;</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    deduplicated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronTickSkipped = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    dispatched: false;</span></span>
<span class="line"><span style="color:#E6DFDE;">    reason: </span><span style="color:#E7C58C;">&#39;overlap&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CronTickResult = CronTickDispatched | CronTickSkipped;</span></span></code></pre></div>`,23)])])}const E=n(o,[["render",p]]);export{h as __pageData,E as default};
