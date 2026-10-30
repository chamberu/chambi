import{_ as n,o as a,c as e,a2 as o}from"./chunks/framework.Di-jvWLj.js";const E=JSON.parse('{"title":"@chamvi/app","description":"","frontmatter":{},"headers":[],"relativePath":"reference/app.md","filePath":"reference/app.md","lastUpdated":1793357966000}'),l={name:"reference/app.md"};function p(t,s,c,r,i,d){return a(),e("div",null,[...s[0]||(s[0]=[o(`<h1 id="chamvi-app" tabindex="-1">@chamvi/app <a class="header-anchor" href="#chamvi-app" aria-label="Permalink to &quot;@chamvi/app&quot;">​</a></h1><p>Boots chamvi agents as an app. The public API of <code>packages/app/src/index.ts</code> and its subpath entries; see <a href="/guide/app">Apps &amp; Modules</a> for the concepts.</p><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/app</span><span style="color:#E7C58C;"> ai</span><span style="color:#E7C58C;"> typeorm</span><span style="color:#E7C58C;"> pg</span></span></code></pre></div><p><code>ai</code>, <code>typeorm</code> and <code>pg</code> are peer dependencies. The provider packages (<code>@ai-sdk/anthropic</code>, <code>@ai-sdk/openai</code>, <code>@ai-sdk/openai-compatible</code>, <code>@ai-sdk/google</code>, <code>@ai-sdk/mistral</code>, <code>@ai-sdk/xai</code>) and the <code>@authup/*</code> packages behind <code>@chamvi/app/authup</code> are optional peers. The other optional modules ship with their feature packages (<code>@chamvi/github/module</code>, ...), so <code>@chamvi/app</code> depends on none of them. The main entry re-exports <code>@chamvi/core</code> and <code>agentPermission</code>, <code>Permission</code> and the <code>Authenticator</code>, <code>Principal</code>, <code>HttpRoute</code>, <code>HttpRouteContext</code>, <code>HttpRouteRequest</code>, <code>HttpRouteResult</code> and <code>StaticToken</code> types of <code>@chamvi/http</code>.</p><table tabindex="0"><thead><tr><th>Entry</th><th>Exports</th><th>Needs</th></tr></thead><tbody><tr><td><code>@chamvi/app</code></td><td><code>createApp</code>, <code>isApp</code>, the built-in modules, the module contract (tokens, <code>ModuleName</code>, <code>AppContext</code>, <code>ILifecycleHook</code>, the <code>IModule</code> and <code>IContainer</code> types), env readers, <code>approvalUrlOf</code>, <code>readConfig</code>, <code>createLogger</code>, <code>BUILTIN_PROVIDERS</code>, the model and check types (<code>ProviderConfig</code>, <code>SecretValue</code>, <code>AppCheckOptions</code>, <code>AppCheckResult</code>, ...)</td><td></td></tr><tr><td><code>@chamvi/app/authup</code></td><td><code>authupModule</code>, <code>oidcModule</code></td><td><code>@authup/server-adapter-kit</code>, <code>@authup/core-http-kit</code></td></tr><tr><td><code>@chamvi/app/testing</code></td><td><code>buildModuleHarness</code>, <code>createModuleHarness</code></td><td></td></tr></tbody></table><h2 id="createapp" tabindex="-1">createApp <a class="header-anchor" href="#createapp" aria-label="Permalink to &quot;createApp&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createApp(options: AppOptions): IApp;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> isApp(value: unknown): value </span><span style="color:#FF7B84;">is</span><span style="color:#E6DFDE;"> IApp;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> APP_BRAND: unique symbol; </span><span style="color:#958A8B;">// Symbol.for(&#39;chamvi.app&#39;)</span></span></code></pre></div><p>Synchronous and side-effect free. <code>agents</code> may be omitted or empty: the agents can come from an <a href="/guide/agent-folders">agents folder</a>, and an app with no agent at all still starts (a warning); <code>app.agents</code> holds only the code agents, the live set is <code>engine.listAgents()</code>. Throws <code>InvalidAgentDefinitionError</code> for options that are no object or whose <code>agents</code> is no array, a module list entry that is no <code>IModule</code> and for two modules of one name (a built-in&#39;s name included: list one module to replace a built-in). <code>isApp</code> checks the brand, so an app of another installed copy matches.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    Agent,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ConversationOptions,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ModelRef,</span></span>
<span class="line"><span style="color:#E6DFDE;">    SkillInput,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { AgentIssue } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/http&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IModule } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;orkos&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Env } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../env/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ModelProviders, ProviderConfig } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../models/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { APP_BRAND } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;./constants.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The code agents; may be omitted or empty when CHAMVI_AGENTS_DIR names an agents folder. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    agents?: Agent[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Additive skill defaults for every code and folder agent, verified before serving. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    skills?: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> SkillInput[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Optional conversation recall and notes; the default store follows the app&#39;s selected data source. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    conversations?: ConversationOptions;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Extra modules; one named like a built-in (\`ModuleName\`) replaces it. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    modules?: IModule[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** The default model of agents without one; CHAMVI_MODEL and the config file win. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    model?: ModelRef;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Named providers model strings resolve through; env and the config file win per field. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    providers?: Record&lt;string, ProviderConfig&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** AI SDK providers by id; they win over every provider setting for their ids. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    models?: ModelProviders;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppLifecycleOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`process.env\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Env;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppStartOptions = AppLifecycleOptions &amp; {</span></span>
<span class="line"><span style="color:#E6DFDE;">    dev?: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppCheckOptions = AppStartOptions;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppCheckResult = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The agent folders&#39; load issues (\`AGENT_ISSUES\`), one per folder; empty without an agents dir. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    issues: AgentIssue[];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppRunJobOptions = AppLifecycleOptions &amp; {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Cron subscription id; optional when the agent has exactly one cron subscription. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    subscription?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppRunJobResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode: </span><span style="color:#E7C58C;">0</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">1</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * An app: built by createApp, run once by one of \`start\`, \`runJob\` or</span></span>
<span class="line"><span style="color:#958A8B;"> * \`migrate\` (a second lifecycle rejects with \`app_in_use\`).</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IApp {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> [APP_BRAND]: true;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The code agents (createApp&#39;s \`agents\`); folder agents are in the engine&#39;s live set. */</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> agents: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> Agent[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Sets every module up; resolves once the HTTP server listens. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    start(options?: AppStartOptions): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Memoized: aborts the lifecycle, waits for it, tears every module down;</span></span>
<span class="line"><span style="color:#958A8B;">     * rejects with \`app_stop_failed\` when anything was reported meanwhile.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stop(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Fires one cron subscription once and waits for its run (no channel started, no HTTP). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    runJob(options: AppRunJobOptions): Promise&lt;AppRunJobResult&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Migrates the store (DATABASE_URL required) and closes it. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    migrate(options?: AppLifecycleOptions): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The start path up to its start steps (\`context.check\`, mode \`start\`):</span></span>
<span class="line"><span style="color:#958A8B;">     * config, store connection, model settings, every module&#39;s setup and</span></span>
<span class="line"><span style="color:#958A8B;">     * onReady and the agent folders&#39; load and checks, then the teardown; no</span></span>
<span class="line"><span style="color:#958A8B;">     * engine or channel start, no server, no run, no skill provider calls or</span></span>
<span class="line"><span style="color:#958A8B;">     * content verification, no store write (no</span></span>
<span class="line"><span style="color:#958A8B;">     * migration, marker, cancel or lock). Resolves the agent folders&#39; load</span></span>
<span class="line"><span style="color:#958A8B;">     * issues; the lifecycle hooks \`engineCreated\` and \`drained\` run, never</span></span>
<span class="line"><span style="color:#958A8B;">     * \`started\` or \`stopping\`. A configuration error rejects (\`invalid_agent_definition\`), a</span></span>
<span class="line"><span style="color:#958A8B;">     * store failure with its own code (\`store_not_migrated\`, a connection</span></span>
<span class="line"><span style="color:#958A8B;">     * error). The app&#39;s one lifecycle, like start().</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    check(options?: AppCheckOptions): Promise&lt;AppCheckResult&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div><table tabindex="0"><thead><tr><th>Method</th><th>Builds</th><th>Rejects with</th></tr></thead><tbody><tr><td><code>start</code></td><td>config, store (migrated unless <code>CHAMVI_MIGRATE=false</code>), engine with every contributed channel (the cron channel fires unless <code>CHAMVI_SCHEDULER=false</code>), http; starts the engine (and so its channels) once every module built, resolves once listening</td><td>the setup error (a module graph error as <code>InvalidAgentDefinitionError</code>); <code>app_stopped</code> when <code>stop()</code> interrupted the setup (the setup&#39;s own error is logged); <code>app_in_use</code> for a second lifecycle or after <code>stop()</code></td></tr><tr><td><code>stop</code></td><td>the shutdown sequence (see <a href="/guide/app#start-and-stop">Start and stop</a>); memoized, waits for a setup in flight</td><td><code>app_stop_failed</code> when a teardown failed (each failure is logged)</td></tr><tr><td><code>runJob</code></td><td>config, store (migrated), engine (not started: <code>@chamvi/channel-cron</code> <code>runJob</code> starts it without channels, ticks and drains it); no http</td><td>the job&#39;s error; <code>app_in_use</code></td></tr><tr><td><code>migrate</code></td><td>config, store (<code>migrateStore</code>), store teardown</td><td><code>InvalidAgentDefinitionError</code> without <code>DATABASE_URL</code>; <code>app_in_use</code></td></tr><tr><td><code>check</code></td><td>the <code>start</code> path up to its start steps (<code>context.check</code>, mode <code>start</code>): config, store (connected, never migrated: pending migrations reject with <code>store_not_migrated</code> unless <code>CHAMVI_MIGRATE</code> is on), the model settings, every module&#39;s setup and onReady, the agent folders loaded and checked (<code>engine.checkAgent()</code>, never <code>putAgent</code>), then the teardown. No engine or channel start, no server, no run, no store write (no migration, revision marker, cancel or lock). Resolves <code>{ issues }</code>, the agent folders&#39; load issues</td><td>the setup error (<code>invalid_agent_definition</code> for a configuration error), the store&#39;s (<code>store_not_migrated</code>, a connection error); <code>app_in_use</code>: it is the app&#39;s one lifecycle</td></tr></tbody></table><p><code>runJob</code> resolves <code>exitCode: 0</code> for a <code>completed</code>, <code>waiting</code>, <code>skipped</code>, queued-behind-an-approval or signal-interrupted run, <code>1</code> for <code>failed</code> or <code>cancelled</code>.</p><h2 id="errors" tabindex="-1">Errors <a class="header-anchor" href="#errors" aria-label="Permalink to &quot;Errors&quot;">​</a></h2><p><code>ChamviError</code> codes in <code>APP_ERROR_CODE</code>:</p><table tabindex="0"><thead><tr><th>Code</th><th>When</th></tr></thead><tbody><tr><td><code>app_stopped</code></td><td>The lifecycle&#39;s abort reason once <code>stop()</code> was called; a start stopped while setting up rejects with it</td></tr><tr><td><code>app_in_use</code></td><td>A second <code>start</code>, <code>runJob</code> or <code>migrate</code> on the same app</td></tr><tr><td><code>app_stop_failed</code></td><td><code>stop()</code> (or a job&#39;s teardown) after one or more teardown errors, each logged</td></tr></tbody></table><p>Configuration errors (a malformed or missing variable, a model string naming a provider that is not configured, an agent with no model and no default, a duplicate module name) are core <code>InvalidAgentDefinitionError</code>s; they name the variable and never echo its value.</p><h2 id="environment" tabindex="-1">Environment <a class="header-anchor" href="#environment" aria-label="Permalink to &quot;Environment&quot;">​</a></h2><p>Read by <code>readConfig(env, { mode, dev })</code> once per lifecycle; the optional module factories read their own variables when they are called. Empty string is unset, integers are <code>/^\\d+$/</code> (every <code>*_MS</code> variable at most <code>TIMER_MAX_MS</code>, 2147483647, since a larger Node timer fires after 1 ms), booleans <code>true</code>, <code>false</code>, <code>1</code> or <code>0</code>.</p><table tabindex="0"><thead><tr><th>Variable</th><th>Module</th><th>Type</th><th>Default</th><th>Required when</th></tr></thead><tbody><tr><td><code>PORT</code></td><td>http</td><td>int 1..65535</td><td><code>3000</code></td><td>never</td></tr><tr><td><code>HOST</code></td><td>http</td><td>string</td><td><code>0.0.0.0</code></td><td>never</td></tr><tr><td><code>CHAMVI_BASE_PATH</code></td><td>http</td><td>empty or <code>^(?:\\/[a-z0-9._~-]+)+$</code></td><td><code>&#39;&#39;</code> (health at <code>/healthz</code>, UI at <code>/ui</code>)</td><td>never</td></tr><tr><td><code>CHAMVI_PUBLIC_URL</code></td><td>http, ui, channels</td><td>absolute URL</td><td>unset</td><td>an approval link is wanted</td></tr><tr><td><code>CHAMVI_LOG_LEVEL</code></td><td>config</td><td><code>error</code>, <code>warn</code>, <code>info</code>, <code>debug</code></td><td><code>info</code></td><td>never</td></tr><tr><td><code>DATABASE_URL</code></td><td>store</td><td><code>postgres://...</code></td><td>unset: <code>createMemoryStore()</code> (warned outside dev)</td><td><code>migrate</code>; any multi-replica or CronJob deployment</td></tr><tr><td><code>CHAMVI_MIGRATE</code></td><td>store</td><td>bool</td><td><code>true</code></td><td>never</td></tr><tr><td><code>CHAMVI_PURGE_INTERVAL_MS</code></td><td>store</td><td>int, <code>0</code> disables</td><td><code>3600000</code> (for purgeable capability repositories, on <code>engine.clock</code>)</td><td>never</td></tr><tr><td><code>CHAMVI_MAX_CONCURRENT_RUNS</code></td><td>engine</td><td>int &gt;= 1</td><td><code>4</code></td><td>never</td></tr><tr><td><code>CHAMVI_SCHEDULER</code></td><td>scheduler</td><td>bool</td><td><code>true</code>; <code>false</code> starts no in-process cron (CronJob mode; <code>cron.on()</code> subscriptions still validate)</td><td>never</td></tr><tr><td><code>CHAMVI_AGENTS_DIR</code></td><td>agents</td><td>path of a directory, relative to the working directory</td><td>unset: <code>./agents</code> when it is a directory, else no <a href="/guide/agent-folders">agent folders</a></td><td></td></tr><tr><td><code>CHAMVI_AGENTS_POLL_MS</code></td><td>agents</td><td>int 1..<code>TIMER_MAX_MS</code></td><td><code>5000</code> (<code>DEFAULT_AGENTS_POLL_MS</code>)</td><td>never</td></tr><tr><td><code>CHAMVI_READINESS_DELAY_MS</code></td><td>http shutdown</td><td>int</td><td><code>0</code></td><td>never</td></tr><tr><td><code>CHAMVI_DRAIN_TIMEOUT_MS</code></td><td>http shutdown</td><td>int</td><td><code>30000</code> (dev 5000)</td><td>never</td></tr><tr><td><code>CHAMVI_CLOSE_TIMEOUT_MS</code></td><td>http shutdown</td><td>int</td><td><code>5000</code></td><td>never</td></tr><tr><td><code>CHAMVI_FORCE_EXIT_MS</code></td><td>cli</td><td>int</td><td><code>90000</code> (dev 15000)</td><td>never</td></tr><tr><td><code>CHAMVI_TOKENS</code></td><td>static tokens</td><td>JSON <code>[{ &quot;value&quot;, &quot;id&quot;, &quot;permissions&quot;: [] }]</code>, <code>value</code> at least 16 characters and unique</td><td>unset (dev: one random <code>*</code> token, warned)</td><td>no other authenticator is configured, outside dev</td></tr><tr><td><code>AUTHUP_URL</code>, <code>AUTHUP_CLIENT_ID</code>, <code>AUTHUP_CLIENT_SECRET</code></td><td><code>authupModule</code></td><td>URL, string, string</td><td>unset</td><td><code>authupModule()</code> without options</td></tr><tr><td><code>CHAMVI_UI_AUTHUP_CLIENT_ID</code>, <code>CHAMVI_UI_AUTHUP_REALM_ID</code></td><td><code>uiModule</code></td><td>string</td><td>unset (token login only)</td><td>the dashboard signs in through authup (URL from <code>AUTHUP_URL</code>)</td></tr><tr><td><code>CHAMVI_MODEL</code></td><td>engine</td><td><code>&#39;&lt;provider&gt;/&lt;model id&gt;&#39;</code></td><td>the config file&#39;s <code>model</code>, else <code>createApp({ model })</code></td><td>an agent has no model of its own</td></tr><tr><td><code>CHAMVI_CONFIG_FILE</code></td><td>engine</td><td>path of a JSON file, relative to the working directory</td><td>unset: <code>./chamvi.json</code> when it exists</td><td>never</td></tr><tr><td><code>CHAMVI_PROVIDER_&lt;NAME&gt;_TYPE</code>, <code>_API_KEY</code>, <code>_BASE_URL</code>, <code>_HEADER_&lt;HEADER&gt;</code></td><td>engine</td><td>type, secret, absolute http(s) URL, secret</td><td>unset; each field wins over the config file and code for provider <code>&lt;name&gt;</code> (upper snake case: <code>TEAM_A</code> is <code>team-a</code>)</td><td><code>_TYPE</code> when no other source declares <code>&lt;name&gt;</code>; <code>_API_KEY</code> for every type but <code>openai-compatible</code> (<a href="/guide/models#providers">providers</a>)</td></tr><tr><td><code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>GOOGLE_GENERATIVE_AI_API_KEY</code>, <code>MISTRAL_API_KEY</code>, <code>XAI_API_KEY</code></td><td>engine</td><td>string</td><td>unset</td><td>a model string names that implicit provider and nothing declares it; <code>ANTHROPIC_BASE_URL</code>, <code>OPENAI_BASE_URL</code> set its base URL (<a href="/guide/models#implicit-providers">implicit providers</a>)</td></tr><tr><td><code>GITHUB_APP_ID</code>, <code>GITHUB_APP_PRIVATE_KEY</code> (PEM, literal <code>\\n</code> allowed), <code>GITHUB_WEBHOOK_SECRET</code> (comma-separated for rotation)</td><td><code>githubModule</code></td><td>string</td><td>none</td><td><code>githubModule()</code> without options</td></tr><tr><td><code>GITHUB_INSTALLATION_ID</code>, <code>GITHUB_APP_SLUG</code>, <code>GITHUB_API_URL</code></td><td><code>githubModule</code></td><td>int, slug, https URL</td><td>unset</td><td>never</td></tr><tr><td><code>OPENCLAW_BASE_URL</code>, <code>OPENCLAW_HOOKS_TOKEN</code>, <code>OPENCLAW_CHANNEL</code>, <code>OPENCLAW_TO</code></td><td><code>openclawModule</code></td><td>URL, string, string, string</td><td>none</td><td><code>openclawModule()</code> without options</td></tr><tr><td><code>OPENCLAW_HOOKS_PATH</code>, <code>OPENCLAW_AGENT_ID</code>, <code>OPENCLAW_ACCOUNT_ID</code></td><td><code>openclawModule</code></td><td>string</td><td><code>/hooks</code>, unset, unset</td><td>never</td></tr><tr><td><code>CHAMVI_SANDBOX_PROVIDER</code></td><td><code>sandboxModule</code></td><td><code>local</code>, <code>docker</code>, <code>kubernetes</code></td><td>the <code>provider</code> option, else <code>local</code></td><td>never</td></tr><tr><td><code>CHAMVI_SANDBOX_NAMESPACE</code></td><td><code>sandboxModule</code></td><td>string</td><td>none</td><td>provider <code>kubernetes</code></td></tr><tr><td><code>CHAMVI_SANDBOX_IMAGE</code></td><td><code>sandboxModule</code></td><td>image ref</td><td><code>ghcr.io/chamvi/sandbox-dev:trixie</code></td><td>never</td></tr><tr><td><code>CHAMVI_SANDBOX_IMAGES</code></td><td><code>sandboxModule</code></td><td>comma list of image refs</td><td>none (also a list without an entry): <code>create_workspace</code> offers no <code>image</code></td><td>never</td></tr><tr><td><code>CHAMVI_DEPLOYMENT</code></td><td><code>sandboxModule</code></td><td>label value (at most 63 letters, digits, <code>-</code>, <code>_</code>, <code>.</code>)</td><td>the <code>deployment</code> option, else <code>default</code></td><td>several apps share one Docker host or namespace (one value per app); only with a value are the workspaces of runs the store does not hold collected</td></tr></tbody></table><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> readConfig(env: Env, options: ReadConfigOptions): AppConfig;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> approvalUrlOf(config: AppConfig): ((ref: ApprovalRef) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> string) | undefined; </span><span style="color:#958A8B;">// needs CHAMVI_PUBLIC_URL</span></span></code></pre></div><p>The env readers modules build on, each throwing <code>InvalidAgentDefinitionError</code> that names the variable:</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> envString(env: Env, name: string, options?: EnvStringOptions): string | undefined;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> envInteger(env: Env, name: string, options?: EnvIntegerOptions): number | undefined;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> envBoolean(env: Env, name: string, options?: EnvReadOptions&lt;boolean&gt;): boolean | undefined;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> envUrl(env: Env, name: string, options?: EnvUrlOptions): string | undefined;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> envList(env: Env, name: string, options?: EnvReadOptions&lt;string[]&gt;): string[] | undefined; </span><span style="color:#958A8B;">// comma-separated</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> envJson(env: Env, name: string, options?: EnvJsonOptions): unknown;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> envOneOf&lt;T </span><span style="color:#FF7B84;">extends</span><span style="color:#E6DFDE;"> string&gt;(env: Env, name: string, values: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> T[], options?: EnvReadOptions&lt;T&gt;): T | undefined;</span></span></code></pre></div><p>With <code>required: true</code> or a <code>default</code> the overloads return a defined value.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Env = Record&lt;string, string | undefined&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EnvReadOptions&lt;T&gt; = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Used when the variable is unset or empty. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    default?: T;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Throws when the variable is unset or empty and no default is given. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    required?: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Options that make a reader return a defined value. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EnvDefinedOptions&lt;T&gt; = { required: true } | { default: T };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EnvStringOptions = EnvReadOptions&lt;string&gt; &amp; { minLength?: number };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EnvIntegerOptions = EnvReadOptions&lt;number&gt; &amp; { min?: number; max?: number };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EnvUrlOptions = EnvReadOptions&lt;string&gt; &amp; { protocols?: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[] };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EnvJsonOptions = { required?: boolean };</span></span></code></pre></div><h2 id="http-intake-and-execution-ceilings" tabindex="-1">HTTP intake and execution ceilings <a class="header-anchor" href="#http-intake-and-execution-ceilings" aria-label="Permalink to &quot;HTTP intake and execution ceilings&quot;">​</a></h2><p><code>httpModule({ channelRateLimits, trustProxy })</code> forwards the <a href="/reference/http#channel-http-request-limits">channel request policies</a> to <code>createHttpApp()</code>. Configure a mounted channel by its exact name, with <code>{ max, windowMs? }</code> for a separate per-client bucket or <code>false</code> to disable only that channel&#39;s intake limiter. No environment variable is added for this setting. Trust only known proxy sources.</p><p><code>CHAMVI_MAX_CONCURRENT_RUNS</code> is the local engine ceiling. Agent and subscription <code>concurrencyMaxRuns?: number | false</code> add nested shared-store ceilings; see <a href="/guide/concurrency#shared-agent-and-subscription-ceilings">Concurrency</a>.</p><h2 id="built-in-modules" tabindex="-1">Built-in modules <a class="header-anchor" href="#built-in-modules" aria-label="Permalink to &quot;Built-in modules&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> configModule(options?: ConfigModuleOptions): IModule;            </span><span style="color:#958A8B;">// &#39;chamvi:config&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> storeModule(options?: StoreModuleOptions): IModule;              </span><span style="color:#958A8B;">// &#39;chamvi:store&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> staticTokensModule(options?: StaticTokensModuleOptions): IModule; </span><span style="color:#958A8B;">// &#39;chamvi:static-tokens&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> engineModule(options?: EngineModuleOptions): IModule;            </span><span style="color:#958A8B;">// &#39;chamvi:engine&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> agentsModule(): IModule;                                         </span><span style="color:#958A8B;">// &#39;chamvi:agents&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> schedulerModule(options?: SchedulerModuleOptions): IModule;      </span><span style="color:#958A8B;">// &#39;chamvi:scheduler&#39;, the cron channel</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> httpModule(options?: HttpModuleOptions): IModule;                </span><span style="color:#958A8B;">// &#39;chamvi:http&#39;, the http, mcp and webhook channels</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> consoleChannelModule(options?: ConsoleChannelModuleOptions): IModule; </span><span style="color:#958A8B;">// &#39;chamvi:console&#39; (&#39;chamvi:console:&lt;name&gt;&#39; with a name)</span></span></code></pre></div><p>Listing one of them in <code>createApp({ modules })</code> replaces the default instance. <code>engineModule()</code> reads the <a href="/guide/models">model settings</a> in <code>setup</code> (<code>start</code> and <code>job</code> mode: env over the config file over <code>createApp({ model, providers })</code>, <code>models</code> over all for its ids), refusing every settings issue at once (<code>The model settings have &lt;n&gt; issue(s):</code> and one line each), imports the provider packages the settings need and passes the default model and the resolver to the <code>Engine</code> as <code>model</code> and <code>models</code>, which checks every agent when it is registered; it never reads or sets the AI SDK&#39;s global default provider. <code>agentsModule()</code> (no options) reads <code>CHAMVI_AGENTS_DIR</code>, else takes <code>./agents</code> when it is a directory: in <code>start</code> and <code>job</code> mode its <code>onReady</code> loads every folder into the engine before any start step (a dir that is no directory is <code>InvalidAgentDefinitionError</code>), and in <code>start</code> mode a lifecycle hook polls the dir from <code>started</code> until <code>stopping</code>; it registers <code>AppToken.AGENT_ISSUES</code>, which the http module passes on as <code>agentIssues</code>. A folder agent passes every <code>AppToken.AGENT_CHECKS</code> contribution (the scheduler module&#39;s <code>assertSchedulable</code>, the http module&#39;s <code>assertMcpRunTool</code> unless <code>mcp: false</code>) and the engine&#39;s registration checks in <code>putAgent</code> (every subscription names a registered channel, the model resolves through the app&#39;s providers) before it is registered; a refusal is a load issue, never a failed boot. Only <code>start</code> mode removes an agent whose marker has no folder; a job never does. Without a dir it only refuses an app without agents.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ILogger } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../../logger/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ConfigModuleOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`AppToken.CLOCK\`; default \`systemClock\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`AppToken.LOGGER\`; default the JSON line logger at \`CHAMVI_LOG_LEVEL\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    logger?: ILogger;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p><code>StoreModuleOptions</code> (<code>store</code> is used as is and never closed; <code>dataSource</code> must be initialized, is migrated like a built one and never destroyed; <code>url</code> wins over <code>DATABASE_URL</code>; a data source built from a URL waits at most 10 s for Postgres to accept the first connection):</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock, IStore } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { DataSource } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;typeorm&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ILogger } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../../logger/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> StoreModuleOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** A Postgres URL; default \`DATABASE_URL\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    url?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Used as is and never closed. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    store?: IStore;</span></span>
<span class="line"><span style="color:#958A8B;">    /** An initialized data source, shared by the TypeORM repositories and never destroyed. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    dataSource?: DataSource;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A capability store with expired records to remove. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PurgingRepository = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    purgeExpired(): Promise&lt;unknown&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PurgeTimerOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    repositories: PurgingRepository[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">    intervalMs: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    logger: ILogger;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IPurgeTimer {</span></span>
<span class="line"><span style="color:#E6DFDE;">    start(): void;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Idempotent; keeps a call in flight from re-arming and resolves once it settled. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stop(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { StaticToken } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/http&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> StaticTokensModuleOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`CHAMVI_TOKENS\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    tokens?: StaticToken[];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EngineModuleOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Claim owner; default the engine&#39;s \`\${hostname}-\${pid}\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    owner?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Claim lease; default the engine&#39;s 60 s. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    claimTtlMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SchedulerModuleOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Lock owner; default the cron channel&#39;s \`\${hostname}-\${pid}\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    owner?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default the cron channel&#39;s SCHEDULE_LOCK_TTL_MS. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    lockTtlMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { HttpAppOptions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/http&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * \`createHttpApp\` options the module passes through (\`bodyLimit\` also bounds</span></span>
<span class="line"><span style="color:#958A8B;"> * the webhook channel&#39;s deliveries); \`engine\`, \`auth\`, \`shutdown\`, \`routes\`,</span></span>
<span class="line"><span style="color:#958A8B;"> * \`channels\`, \`basePath\` and \`onError\` come from the app.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> HttpModuleOptions = Omit&lt;HttpAppOptions, </span><span style="color:#E7C58C;">&#39;engine&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;auth&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;shutdown&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;routes&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;channels&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;basePath&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;onError&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span></code></pre></div><h2 id="optional-modules" tabindex="-1">Optional modules <a class="header-anchor" href="#optional-modules" aria-label="Permalink to &quot;Optional modules&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">// @chamvi/github/module</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> githubModule(options?: GithubModuleOptions): GithubModule;        </span><span style="color:#958A8B;">// .app: IGithubApp and the github channel, &#39;chamvi:github&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">// @chamvi/sandbox/module</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> sandboxModule(options?: SandboxModuleOptions): SandboxModule;     </span><span style="color:#958A8B;">// .manager: IWorkspaceManager, &#39;chamvi:sandbox&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">// @chamvi/channel-openclaw/module</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> openclawModule(options?: OpenclawModuleOptions): IModule;         </span><span style="color:#958A8B;">// &#39;chamvi:channel:&lt;name&gt;&#39;, default name &#39;openclaw&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">// @chamvi/ui/module</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> uiModule(options?: UiModuleOptions): IModule;                     </span><span style="color:#958A8B;">// &#39;chamvi:ui&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">// @chamvi/app/authup</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> authupModule(options?: AuthupModuleOptions): IModule;             </span><span style="color:#958A8B;">// &#39;chamvi:authup&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> oidcModule(options: OidcOptions): IModule;                        </span><span style="color:#958A8B;">// &#39;chamvi:oidc&#39;, no env form</span></span></code></pre></div><p>Each factory reads <code>options.env ?? process.env</code> when it is called and throws <code>InvalidAgentDefinitionError</code> naming a missing or malformed variable. Options win over env, except <code>CHAMVI_SANDBOX_PROVIDER</code>, <code>CHAMVI_SANDBOX_NAMESPACE</code>, <code>CHAMVI_SANDBOX_IMAGE</code>, <code>CHAMVI_SANDBOX_IMAGES</code> (over <code>allowImage</code>) and <code>CHAMVI_DEPLOYMENT</code>, which win over the sandbox options. The GitHub and OpenClaw modules contribute their channel to <code>AppToken.CHANNELS</code>, defaulting <code>approvalUrl</code> to the dashboard link built from <code>CHAMVI_PUBLIC_URL</code> and using the app&#39;s clock; tools reach a channel with <code>ctx.channels.findOne(name)</code>. <code>githubModule</code> and <code>sandboxModule</code> provide their instance on the engine in the <code>engineCreated</code> hook; tools reach it through the package&#39;s context pair (<a href="/reference/github#context">github</a>, <a href="/reference/sandbox#context">sandbox</a>).</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Env } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/app&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { GithubAppOptions, IGithubApp } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../app/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { GithubChannelOptions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../channel/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { GithubAppCredentialsOptions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../credentials/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`githubChannel()\` options; \`approvalUrl\` defaults to the UI link from \`CHAMVI_PUBLIC_URL\`, \`clock\` is the app&#39;s. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubModuleChannelOptions = Omit&lt;GithubChannelOptions, </span><span style="color:#E7C58C;">&#39;app&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;clock&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubModuleOptions = Partial&lt;GithubAppOptions&gt; &amp; {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Used as is; no env is read then. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    app?: IGithubApp;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`process.env\`, read when the factory is called. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Env;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The channel&#39;s options (name, mentions, approval link, timeout, body limit). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    channel?: GithubModuleChannelOptions;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The App&#39;s git credentials (\`githubAppCredentials()\`), contributed to</span></span>
<span class="line"><span style="color:#958A8B;">     * \`AppToken.GIT_CREDENTIALS\` for \`sandboxModule()\`&#39;s workspaces; \`false\`</span></span>
<span class="line"><span style="color:#958A8B;">     * contributes none. Default on, with no permission beyond \`contents\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    credentials?: false | GithubAppCredentialsOptions;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SandboxProviderName = </span><span style="color:#E7C58C;">&#39;local&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;docker&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;kubernetes&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * \`createWorkspaceManager()\` options; the manager&#39;s \`env\` is \`workspaceEnv\`</span></span>
<span class="line"><span style="color:#958A8B;"> * here, since \`env\` is the process env the factory reads. \`deployment\`:</span></span>
<span class="line"><span style="color:#958A8B;"> * \`CHAMVI_DEPLOYMENT\` wins; \`isSettled\` defaults to the engine&#39;s \`getRun\`</span></span>
<span class="line"><span style="color:#958A8B;"> * (a settled run, and with a named deployment also a missing one).</span></span>
<span class="line"><span style="color:#958A8B;"> * \`allowImage\`: \`CHAMVI_SANDBOX_IMAGES\` (a comma list of exact image</span></span>
<span class="line"><span style="color:#958A8B;"> * references) wins; without either, \`create_workspace\` offers no \`image\`.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SandboxModuleOptions = Omit&lt;WorkspaceManagerOptions, </span><span style="color:#E7C58C;">&#39;provider&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;env&#39;</span><span style="color:#E6DFDE;">&gt; &amp; {</span></span>
<span class="line"><span style="color:#958A8B;">    /** A provider name (\`CHAMVI_SANDBOX_PROVIDER\` wins) or an instance; default \`&#39;local&#39;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    provider?: SandboxProviderName | ISandboxProvider;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Used as is; no provider is built then. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    manager?: IWorkspaceManager;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Kubernetes namespace of the workspace pods; \`CHAMVI_SANDBOX_NAMESPACE\` wins. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    namespace?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Docker and Kubernetes image; \`CHAMVI_SANDBOX_IMAGE\` wins, default \`DEFAULT_SANDBOX_IMAGE\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Added to every workspace&#39;s environment. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspaceEnv?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`process.env\`, read when the factory is called. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Env;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Env } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/app&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { OpenclawChannelOptions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../channel/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * \`openclawChannel()\` options; the ones not given come from env,</span></span>
<span class="line"><span style="color:#958A8B;"> * \`approvalUrl\` defaults to the UI link from \`CHAMVI_PUBLIC_URL\`, \`clock\` to</span></span>
<span class="line"><span style="color:#958A8B;"> * the app&#39;s.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> OpenclawModuleOptions = Partial&lt;OpenclawChannelOptions&gt; &amp; {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`process.env\`, read when the factory is called. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Env;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Env } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/app&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { UiRoutesOptions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../routes/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`uiRoutes()\` options; \`auth\` defaults to the token login plus authup from env. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> UiModuleOptions = UiRoutesOptions &amp; {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`process.env\`, read when the factory is called. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Env;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ITokenVerifier } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@authup/server-adapter-kit&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Env } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../env/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AuthupModuleOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Used as is; no env is read then. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    verifier?: ITokenVerifier;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`AUTHUP_URL\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    url?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`AUTHUP_CLIENT_ID\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    clientId?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`AUTHUP_CLIENT_SECRET\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    clientSecret?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`process.env\`, read when the factory is called. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Env;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="tokens-and-hooks" tabindex="-1">Tokens and hooks <a class="header-anchor" href="#tokens-and-hooks" aria-label="Permalink to &quot;Tokens and hooks&quot;">​</a></h2><p><code>AppToken</code> holds the container keys, <code>ModuleName</code> the built-in names, <code>AUTHENTICATOR_ORDER</code> the chain order (static tokens <code>0</code>, authup <code>10</code>, oidc <code>20</code>, lowest first):</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#E6DFDE;"> { TypedToken } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;eldin&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { AppTokens } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;./types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> token&lt;K </span><span style="color:#FF7B84;">extends</span><span style="color:#FF7B84;"> keyof</span><span style="color:#E6DFDE;"> AppTokens&gt;(key: K): TypedToken&lt;AppTokens[K]&gt; {</span></span>
<span class="line"><span style="color:#FF7B84;">    return</span><span style="color:#FF7B84;"> new</span><span style="color:#E6DFDE;"> TypedToken&lt;AppTokens[K]&gt;(</span><span style="color:#E7C58C;">\`chamvi.</span><span style="color:#E6DFDE;">\${</span><span style="color:#E7C58C;">key</span><span style="color:#E6DFDE;">.</span><span style="color:#E7C58C;">toLowerCase</span><span style="color:#E6DFDE;">().</span><span style="color:#E7C58C;">replace</span><span style="color:#E6DFDE;">(</span><span style="color:#E7C58C;">/_/</span><span style="color:#FF7B84;">g</span><span style="color:#E6DFDE;">,</span><span style="color:#E7C58C;"> &#39;-&#39;</span><span style="color:#E6DFDE;">)</span><span style="color:#E6DFDE;">}</span><span style="color:#E7C58C;">\`</span><span style="color:#E6DFDE;">);</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The container keys modules share. \`HTTP_ROUTES\`, \`AUTHENTICATORS\`,</span></span>
<span class="line"><span style="color:#958A8B;"> * \`CHANNELS\`, \`LIFECYCLE_HOOKS\`, \`AGENT_CHECKS\` and \`GIT_CREDENTIALS\` are collections (\`registerMany\` in</span></span>
<span class="line"><span style="color:#958A8B;"> * \`setup\`, \`resolveAll\` in \`onReady\`); every other token holds one value.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> AppToken = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    CONTEXT: token(</span><span style="color:#E7C58C;">&#39;CONTEXT&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    CONFIG: token(</span><span style="color:#E7C58C;">&#39;CONFIG&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    LOGGER: token(</span><span style="color:#E7C58C;">&#39;LOGGER&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    CLOCK: token(</span><span style="color:#E7C58C;">&#39;CLOCK&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    STORE: token(</span><span style="color:#E7C58C;">&#39;STORE&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    DATA_SOURCE: token(</span><span style="color:#E7C58C;">&#39;DATA_SOURCE&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    ENGINE: token(</span><span style="color:#E7C58C;">&#39;ENGINE&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    SHUTDOWN: token(</span><span style="color:#E7C58C;">&#39;SHUTDOWN&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    SERVER: token(</span><span style="color:#E7C58C;">&#39;SERVER&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    HTTP_ROUTES: token(</span><span style="color:#E7C58C;">&#39;HTTP_ROUTES&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    AUTHENTICATORS: token(</span><span style="color:#E7C58C;">&#39;AUTHENTICATORS&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    CHANNELS: token(</span><span style="color:#E7C58C;">&#39;CHANNELS&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    LIFECYCLE_HOOKS: token(</span><span style="color:#E7C58C;">&#39;LIFECYCLE_HOOKS&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    AGENT_ISSUES: token(</span><span style="color:#E7C58C;">&#39;AGENT_ISSUES&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    AGENT_CHECKS: token(</span><span style="color:#E7C58C;">&#39;AGENT_CHECKS&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">    GIT_CREDENTIALS: token(</span><span style="color:#E7C58C;">&#39;GIT_CREDENTIALS&#39;</span><span style="color:#E6DFDE;">),</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">as</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The built-in modules&#39; names; list a module of the same name to replace one.</span></span>
<span class="line"><span style="color:#958A8B;"> * \`CONSOLE\` names the optional \`consoleChannelModule()\`.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> ModuleName = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    CONFIG: </span><span style="color:#E7C58C;">&#39;chamvi:config&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    STORE: </span><span style="color:#E7C58C;">&#39;chamvi:store&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    STATIC_TOKENS: </span><span style="color:#E7C58C;">&#39;chamvi:static-tokens&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ENGINE: </span><span style="color:#E7C58C;">&#39;chamvi:engine&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    AGENTS: </span><span style="color:#E7C58C;">&#39;chamvi:agents&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    SCHEDULER: </span><span style="color:#E7C58C;">&#39;chamvi:scheduler&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    HTTP: </span><span style="color:#E7C58C;">&#39;chamvi:http&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    CONSOLE: </span><span style="color:#E7C58C;">&#39;chamvi:console&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">as</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The order of the authenticator chain (lowest first). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> AUTHENTICATOR_ORDER = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    STATIC_TOKENS: </span><span style="color:#E7C58C;">0</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    AUTHUP: </span><span style="color:#E7C58C;">10</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    OIDC: </span><span style="color:#E7C58C;">20</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">as</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> APP_ERROR_CODE = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    STOPPED: </span><span style="color:#E7C58C;">&#39;app_stopped&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IN_USE: </span><span style="color:#E7C58C;">&#39;app_in_use&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    STOP_FAILED: </span><span style="color:#E7C58C;">&#39;app_stop_failed&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#958A8B;">    /** A check (\`IApp.check()\`) found migrations a start would not apply (\`CHAMVI_MIGRATE=false\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    STORE_NOT_MIGRATED: </span><span style="color:#E7C58C;">&#39;store_not_migrated&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">as</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p><code>AppContext</code>, <code>ILifecycleHook</code>, <code>AuthenticatorEntry</code>, <code>Server</code>, <code>AppTokens</code> (each token&#39;s value type) and the re-exported orkos <code>IModule</code> and eldin <code>IContainer</code> types:</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    Agent,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Engine,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IChannel,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IClock,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ModelRef,</span></span>
<span class="line"><span style="color:#E6DFDE;">    SkillInput,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    AgentIssue,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Authenticator,</span></span>
<span class="line"><span style="color:#E6DFDE;">    HttpRoute,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IShutdown,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/http&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { DataSource } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;typeorm&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { AppOptions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../app/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { AppConfig } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../config/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Env } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../env/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ILogger } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../logger/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ModelProviders, ProviderConfig } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../models/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppMode = </span><span style="color:#E7C58C;">&#39;start&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;job&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;migrate&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppContext = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    mode: AppMode;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Explicit createApp conversation capability; absent by default. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    conversations?: AppOptions[</span><span style="color:#E7C58C;">&#39;conversations&#39;</span><span style="color:#E6DFDE;">];</span></span>
<span class="line"><span style="color:#E6DFDE;">    dev: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env: Env;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Aborts with the app_stopped ChamviError once stop() is called. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal: AbortSignal;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Logs through the app logger; during stop() also counts as a stop failure. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    report(error: unknown, context?: Record&lt;string, unknown&gt;): void;</span></span>
<span class="line"><span style="color:#958A8B;">    /** createApp&#39;s \`models\`: AI SDK providers by id, winning over every provider setting for their ids. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    models?: ModelProviders;</span></span>
<span class="line"><span style="color:#958A8B;">    /** createApp&#39;s \`model\`: the default model of agents without one (CHAMVI_MODEL and the config file win). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    model?: ModelRef;</span></span>
<span class="line"><span style="color:#958A8B;">    /** createApp&#39;s \`providers\` (env and the config file win per field). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    providers?: Readonly&lt;Record&lt;string, ProviderConfig&gt;&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** createApp&#39;s agents (the code agents); the live set is \`engine.listAgents()\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    agents: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> Agent[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** createApp&#39;s additive skill defaults; check and migrate never load sources. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    skills?: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> SkillInput[];</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * \`IApp.check()\` (mode \`start\`): every module sets up and checks as for a</span></span>
<span class="line"><span style="color:#958A8B;">     * start, but nothing writes the store and no start step runs. Of the</span></span>
<span class="line"><span style="color:#958A8B;">     * lifecycle hooks only the paired \`engineCreated\` and \`drained\` run.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    check?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`IApp.runJob()\` (mode \`job\`): the agent the job runs. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    job?: { agent: string };</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * Throws InvalidAgentDefinitionError for an agent a module could not serve</span></span>
<span class="line"><span style="color:#958A8B;"> * (the scheduler: a cron subscription hubwire refuses; http: a \`run_&lt;agent&gt;\` MCP</span></span>
<span class="line"><span style="color:#958A8B;"> * tool it cannot build). The agents dir runs every check on a folder agent</span></span>
<span class="line"><span style="color:#958A8B;"> * before registering it, so a refusal is a load issue, never a failed boot.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AgentCheck = (agent: Agent) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * A git credential source (structurally \`@chamvi/sandbox\`&#39;s</span></span>
<span class="line"><span style="color:#958A8B;"> * \`IGitCredentials\`): modules contribute one to \`AppToken.GIT_CREDENTIALS\`</span></span>
<span class="line"><span style="color:#958A8B;"> * (\`githubModule()\` its App&#39;s), and \`sandboxModule()\` asks them after its own.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitCredentialSource = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    get(input: {</span></span>
<span class="line"><span style="color:#E6DFDE;">        url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        host: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        access: </span><span style="color:#E7C58C;">&#39;read&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;write&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">        runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }): Promise&lt;{</span></span>
<span class="line"><span style="color:#E6DFDE;">        username: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        password: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        expiresAt?: Date</span></span>
<span class="line"><span style="color:#E6DFDE;">    } | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ILifecycleHook {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> name: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** After verified preparation, before \`engine.start()\` (start and job); a check skips preparation. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    engineCreated?(engine: Engine): void | Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** start only: after engine.start() (which starts the channels), before serve(). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    started?(): void | Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** start only: the shutdown&#39;s first step, before the closers, the server close and the drain (which stops the channels). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stopping?(): void | Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** After the engine drained (start, job and a check), before the store closes. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    drained?(): void | Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> LifecyclePhase = </span><span style="color:#E7C58C;">&#39;engineCreated&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;started&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;stopping&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;drained&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AuthenticatorEntry = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    order: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    authenticator: Authenticator;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The part of the HTTP server (srvx, from routup&#39;s \`serve()\`) the app uses,</span></span>
<span class="line"><span style="color:#958A8B;"> * typed structurally so srvx&#39;s declarations stay out of the package&#39;s types.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Server = {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> url?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ready(): Promise&lt;unknown&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    close(closeActiveConnections?: boolean): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AppTokens = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    CONTEXT: AppContext;</span></span>
<span class="line"><span style="color:#E6DFDE;">    CONFIG: AppConfig;</span></span>
<span class="line"><span style="color:#E6DFDE;">    LOGGER: ILogger;</span></span>
<span class="line"><span style="color:#E6DFDE;">    CLOCK: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">    STORE: IStore;</span></span>
<span class="line"><span style="color:#E6DFDE;">    DATA_SOURCE: DataSource;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ENGINE: Engine;</span></span>
<span class="line"><span style="color:#E6DFDE;">    SHUTDOWN: IShutdown;</span></span>
<span class="line"><span style="color:#E6DFDE;">    SERVER: Server;</span></span>
<span class="line"><span style="color:#E6DFDE;">    HTTP_ROUTES: HttpRoute;</span></span>
<span class="line"><span style="color:#E6DFDE;">    AUTHENTICATORS: AuthenticatorEntry;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A collection: the channels modules contribute (\`registerMany\` in \`setup\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    CHANNELS: IChannel&lt;any, any&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    LIFECYCLE_HOOKS: ILifecycleHook;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The agents dir&#39;s load issues (\`chamvi:agents\`, when a dir is configured), at the time of the call. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    AGENT_ISSUES: () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#FF7B84;"> readonly</span><span style="color:#E6DFDE;"> AgentIssue[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** A collection: every module&#39;s check of a folder agent before it is registered. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    AGENT_CHECKS: AgentCheck;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A collection: git credential sources modules contribute for the workspaces (\`sandboxModule()\` reads them). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    GIT_CREDENTIALS: GitCredentialSource;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> runHooks(container: IContainer, phase: LifecyclePhase, ...args: unknown[]): Promise&lt;void&gt;; </span><span style="color:#958A8B;">// every LIFECYCLE_HOOKS entry, in order</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> throwIfStopped(context: AppContext): void; </span><span style="color:#958A8B;">// throws the app_stopped error once stop() was called</span></span></code></pre></div><h2 id="testing-modules" tabindex="-1">Testing modules <a class="header-anchor" href="#testing-modules" aria-label="Permalink to &quot;Testing modules&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">// @chamvi/app/testing</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> buildModuleHarness(options?: ModuleHarnessOptions): ModuleHarness;          </span><span style="color:#958A8B;">// not set up yet</span></span>
<span class="line"><span style="color:#FF7B84;">async</span><span style="color:#FF7B84;"> function</span><span style="color:#E6DFDE;"> createModuleHarness(options?: ModuleHarnessOptions): Promise&lt;ModuleHarness&gt;; </span><span style="color:#958A8B;">// set up</span></span></code></pre></div><p>The real module lifecycle without <code>start()</code> and a port, over exactly <code>options.modules</code> (list the built-ins a module needs, e.g. <code>configModule()</code>, <code>storeModule()</code>, <code>engineModule()</code>) on a container holding <code>AppToken.CONTEXT</code> (and <code>CLOCK</code> with <code>clock</code>): <code>setup()</code> runs every <code>setup</code>, every <code>onReady</code> and the start steps like the app and tears down and rethrows when one fails, <code>reported</code> collects every <code>context.report()</code> call (a throwing lifecycle hook lands there), <code>stop()</code> aborts the context signal and tears down.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Agent, IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IContainer } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;eldin&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Application, IModule } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;orkos&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Env } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../env/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { AppContext, AppMode } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../module/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ModuleHarnessReport = { error: unknown; context?: Record&lt;string, unknown&gt; };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ModuleHarnessOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    mode?: AppMode;</span></span>
<span class="line"><span style="color:#E6DFDE;">    dev?: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Env;</span></span>
<span class="line"><span style="color:#E6DFDE;">    modules?: IModule[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    agents?: Agent[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    models?: AppContext[</span><span style="color:#E7C58C;">&#39;models&#39;</span><span style="color:#E6DFDE;">];</span></span>
<span class="line"><span style="color:#958A8B;">    /** createApp&#39;s \`model\`, copied into the context. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    model?: AppContext[</span><span style="color:#E7C58C;">&#39;model&#39;</span><span style="color:#E6DFDE;">];</span></span>
<span class="line"><span style="color:#958A8B;">    /** createApp&#39;s \`providers\`, copied into the context. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    providers?: AppContext[</span><span style="color:#E7C58C;">&#39;providers&#39;</span><span style="color:#E6DFDE;">];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Copied into the context: \`IApp.check()\`&#39;s flag (mode stays \`start\`); \`setup()\` then runs no start steps. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    check?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Copied into the context: the agent a job runs (\`IApp.runJob()\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    job?: AppContext[</span><span style="color:#E7C58C;">&#39;job&#39;</span><span style="color:#E6DFDE;">];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Registered as \`AppToken.CLOCK\` before setup (a config module may replace it). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ModuleHarness = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    application: Application;</span></span>
<span class="line"><span style="color:#E6DFDE;">    container: IContainer;</span></span>
<span class="line"><span style="color:#E6DFDE;">    context: AppContext;</span></span>
<span class="line"><span style="color:#E6DFDE;">    controller: AbortController;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Everything \`context.report()\` received, in order. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    reported: ModuleHarnessReport[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Runs \`application.setup()\` and the start steps, like the app; tears down and rethrows when it fails. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    setup(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Aborts the context signal (app_stopped) and tears every module down. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stop(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="approved-local-skills" tabindex="-1">Approved local skills <a class="header-anchor" href="#approved-local-skills" aria-label="Permalink to &quot;Approved local skills&quot;">​</a></h2><p><code>AppOptions.skills?: readonly SkillInput[]</code> forwards additive defaults for every code and folder agent. An agent&#39;s <code>skills</code> adds extras. Factory inputs come from <code>@chamvi/skills</code>: <code>gitSkills()</code> and <code>loadSkillBundle()</code> work directly; custom snapshots/loaders use <code>defineSkill()</code>/<code>defineSkillSource()</code>. Core supplies the generic <code>SkillInput</code> protocol; skill data types, validation, catalogs and caches belong to skills. Core/app have no dependency on <code>@chamvi/skills</code>, and no skills module registration is needed. Startup verifies globals and code-agent sources before <code>engineCreated</code>; folder-agent extras verify afterward, before channels, HTTP and model execution. <code>check()</code> skips providers and defers content verification; <code>migrate()</code> skips preparation. See <a href="/guide/skills">Approved skills</a> for lifecycle and replay semantics.</p><p>Filesystem review/loading and Git preparation are exported by <a href="/reference/skills"><code>@chamvi/skills</code></a>. App exports no filesystem helpers. Use <code>loadSkillBundle()</code> for a ready snapshot or <code>gitSkills()</code> for an engine-owned source; the manual <code>loadSkillBundles()</code> catalog remains supported by the skills package.</p><h2 id="agent-folders" tabindex="-1">Agent folders <a class="header-anchor" href="#agent-folders" aria-label="Permalink to &quot;Agent folders&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> loadAgent(dir: string, options?: LoadAgentOptions): Promise&lt;LoadedAgent&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> loadAgents(root: string, options?: LoadAgentOptions): Promise&lt;LoadAgentsResult&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> listAgentFolders(root: string): Promise&lt;string[]&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> hashAgentFolder(dir: string): Promise&lt;string&gt;;</span></span></code></pre></div><p><code>loadAgent</code> builds one folder&#39;s agent from its <code>agent.ts</code> (see <a href="/guide/agent-folders#the-folder">the rule</a>) and its content hash, and throws <code>InvalidAgentDefinitionError</code> naming the file relative to the agents dir. <code>loadAgents</code> loads every folder <code>listAgentFolders</code> names (the direct subfolders not starting with <code>.</code> or <code>_</code>, <code>node_modules</code> left out, in code-point order) and returns the failures as <code>issues</code> instead of throwing. <code>hashAgentFolder</code> is sha256 (hex) over every file below the folder, dot-entries skipped, by relative POSIX path. <code>loadAgent</code> also refuses a folder that changed while it was read (<code>&lt;agent&gt;: changed while loading; load it again.</code>), a <code>node_modules</code> folder in the agent folder or the agents dir, and a JavaScript file (<code>.js</code>, <code>.mjs</code> or <code>.cjs</code>) anywhere in the folder. The default reader transpiles <code>agent.ts</code> and every <code>.ts</code>/<code>.mts</code> file it imports on every load and resolves <code>@chamvi/*</code>, <code>ai</code> and <code>@ai-sdk/*</code> to the copies <code>@chamvi/app</code> resolves. The loader holds the only <code>jiti</code> and <code>locter</code> imports of chamvi.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Agent } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A folder agent: the agent built from its folder and the folder&#39;s content hash. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> LoadedAgent = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: Agent;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`hashAgentFolder(dir)\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    hash: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    dir: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A folder that did not load; \`message\` names files relative to the agents dir, never an absolute path. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AgentLoadIssue = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    message: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> LoadAgentOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Reads \`agent.ts\` by absolute path and returns its module namespace. Default: a jiti reader without module</span></span>
<span class="line"><span style="color:#958A8B;">     * cache, so a re-read sees edits (imported files included), while</span></span>
<span class="line"><span style="color:#958A8B;">     * packages from \`node_modules\` load natively (one instance).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    load?: (path: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;unknown&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> LoadAgentsResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agents: LoadedAgent[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    issues: AgentLoadIssue[];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="models" tabindex="-1">Models <a class="header-anchor" href="#models" aria-label="Permalink to &quot;Models&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> BUILTIN_PROVIDERS: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> BuiltinProvider[]; </span><span style="color:#958A8B;">// anthropic, openai, google, mistral, xai: the implicit providers</span></span></code></pre></div><p>See <a href="/guide/models">Pick a Model</a> for the whole picture. <code>createApp({ model, providers, models })</code> sets the default model, the named providers and AI SDK provider objects by id; <code>CHAMVI_MODEL</code>, <code>CHAMVI_CONFIG_FILE</code> (else <code>./chamvi.json</code>) and <code>CHAMVI_PROVIDER_&lt;NAME&gt;_*</code> set the same from the deployment. Sources, highest first: env, the config file, code; providers merge per name and field, a higher source with another <code>type</code> replaces the provider, a <code>CHAMVI_PROVIDER_&lt;NAME&gt;_*</code> variable without <code>_TYPE</code> needs another source to declare <code>&lt;name&gt;</code>, and a declared provider replaces the implicit one of its name. <code>models</code> wins over everything for its ids (no package imported), the test seam.</p><p>Model strings are split at the first <code>/</code>. Every provider gets an explicit key and base URL (the type&#39;s public URL when none is set), read from the app&#39;s <code>env</code> only, never from <code>process.env</code> behind its back; <code>{ file }</code> secrets are read relative to the working directory with one trailing newline trimmed. The config file refuses a literal <code>apiKey</code> and literal credential headers. Errors name the variable or file field and never echo a value: <code>Agent &quot;&lt;a&gt;&quot; uses provider &quot;&lt;p&gt;&quot;, which is not configured. Set CHAMVI_PROVIDER_&lt;P&gt;_TYPE and CHAMVI_PROVIDER_&lt;P&gt;_API_KEY, or declare it in chamvi.json.</code>, <code>Provider &quot;&lt;p&gt;&quot; (&lt;type&gt;) needs CHAMVI_PROVIDER_&lt;P&gt;_API_KEY.</code>, <code>Provider type &quot;&lt;type&gt;&quot; needs package &lt;pkg&gt;.</code> Nothing reads or sets the AI SDK&#39;s global default provider, so two apps in one process keep their own providers.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** createApp&#39;s \`models\`: providers by id, as \`createProviderRegistry()\` takes them. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ModelProviders = Parameters&lt;</span><span style="color:#FF7B84;">typeof</span><span style="color:#E6DFDE;"> createProviderRegistry&gt;[</span><span style="color:#E7C58C;">0</span><span style="color:#E6DFDE;">];</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What a provider is built with: the AI SDK package and factory behind a provider name. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ProviderType = </span><span style="color:#E7C58C;">&#39;anthropic&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;openai&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;openai-compatible&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;google&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;mistral&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;xai&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;gateway&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A secret: a literal, an env variable of the app&#39;s env, or a file (relative to the cwd, one trailing newline trimmed). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SecretValue = string | { env: string } | { file: string };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A named provider, as createApp&#39;s \`providers\` and the config file declare it. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ProviderConfig = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    type: ProviderType;</span></span>
<span class="line"><span style="color:#E6DFDE;">    apiKey?: SecretValue;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Absolute http(s) URL without credentials, query or fragment; default the type&#39;s public URL. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    baseURL?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Header names match \`^[a-z0-9]+(-[a-z0-9]+)*$\` (lower-cased first). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    headers?: Record&lt;string, SecretValue&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Where a setting came from: an env variable, the config file, createApp&#39;s options, or a bare provider variable. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SettingSource = </span><span style="color:#E7C58C;">&#39;env&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;file&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;code&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;implicit&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A provider after merging code, config file and env: secrets resolved, header names lower-cased. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ProviderSettings = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    type: ProviderType;</span></span>
<span class="line"><span style="color:#E6DFDE;">    apiKey?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    baseURL?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    headers: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Where each field came from. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    sources: {</span></span>
<span class="line"><span style="color:#E6DFDE;">        type: SettingSource;</span></span>
<span class="line"><span style="color:#E6DFDE;">        apiKey?: SettingSource;</span></span>
<span class="line"><span style="color:#E6DFDE;">        baseURL?: SettingSource;</span></span>
<span class="line"><span style="color:#E6DFDE;">        headers: Record&lt;string, SettingSource&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    };</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The app&#39;s model settings: the default model and the providers that were read without an issue. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ModelSettings = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    model?: { ref: ModelRef; source: SettingSource };</span></span>
<span class="line"><span style="color:#E6DFDE;">    providers: ReadonlyMap&lt;string, ProviderSettings&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The config file read (absolute), when one was. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    configFile?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A problem found while reading the settings; never holds a secret value. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ModelIssue = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    provider?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    message: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A built-in provider id, its package and the bare env variables it reads. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> BuiltinProvider = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The provider name, the part of a model string before the first \`/\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The npm package. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    package: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The factory the package exports. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    factory: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The env variable holding the API key. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    apiKey: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The env variable holding a base URL, when the provider reads one. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    baseUrl?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p><code>app.check({ env? })</code> (<code>chamvi start --check</code>) runs the same settings through the real start path without starting anything or writing to the store; see <a href="/guide/models#check-before-you-deploy">Check before you deploy</a>.</p><h2 id="logger" tabindex="-1">Logger <a class="header-anchor" href="#logger" aria-label="Permalink to &quot;Logger&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createLogger(options?: LoggerOptions): ILogger;</span></span></code></pre></div><p>One JSON line per entry (<code>{ level, time, msg, ...fields, error? }</code>, the error as <code>{ name, code, message, stack }</code> only, never its <code>cause</code>) on stderr, or through <code>write</code>. The engine&#39;s, the cron channel&#39;s and the HTTP app&#39;s <code>onError</code> all go through it.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { LogLevel } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../config/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ILogger {</span></span>
<span class="line"><span style="color:#E6DFDE;">    error(message: string, error?: unknown, fields?: Record&lt;string, unknown&gt;): void;</span></span>
<span class="line"><span style="color:#E6DFDE;">    warn(message: string, fields?: Record&lt;string, unknown&gt;): void;</span></span>
<span class="line"><span style="color:#E6DFDE;">    info(message: string, fields?: Record&lt;string, unknown&gt;): void;</span></span>
<span class="line"><span style="color:#E6DFDE;">    debug(message: string, fields?: Record&lt;string, unknown&gt;): void;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> LoggerOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Entries below it are dropped; default \`info\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    level?: LogLevel;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The \`time\` of every entry; default \`systemClock\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#958A8B;">    /** One call per JSON line (without the newline); default stderr. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    write?: (line: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SerializedError = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    name?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    code?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    message: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stack?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div>`,71)])])}const F=n(l,[["render",p]]);export{E as __pageData,F as default};
