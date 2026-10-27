import{_ as n,o as a,c as e,a2 as l}from"./chunks/framework.Di-jvWLj.js";const E=JSON.parse('{"title":"@chamvi/github","description":"","frontmatter":{},"headers":[],"relativePath":"reference/github.md","filePath":"reference/github.md","lastUpdated":1793092669000}'),p={name:"reference/github.md"};function o(t,s,c,i,r,y){return a(),e("div",null,[...s[0]||(s[0]=[l(`<h1 id="chamvi-github" tabindex="-1">@chamvi/github <a class="header-anchor" href="#chamvi-github" aria-label="Permalink to &quot;@chamvi/github&quot;">​</a></h1><p>The GitHub channel (webhook deliveries in, issue comments out) and GitHub tools for chamvi agents. The public API of <code>packages/github/src/index.ts</code>.</p><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/github</span><span style="color:#E7C58C;"> @chamvi/http</span><span style="color:#E7C58C;"> @chamvi/core</span><span style="color:#E7C58C;"> ai</span><span style="color:#E7C58C;"> --save</span></span></code></pre></div><p><code>@chamvi/core</code>, <code>@chamvi/http</code> and <code>ai</code> are peer dependencies. See <a href="/deployment/github-app">GitHub App</a> for setup and behaviour.</p><h2 id="creategithubapp" tabindex="-1">createGithubApp <a class="header-anchor" href="#creategithubapp" aria-label="Permalink to &quot;createGithubApp&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createGithubApp(options: GithubAppOptions): IGithubApp;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> DEFAULT_GITHUB_API_URL: </span><span style="color:#E7C58C;">&#39;https://api.github.com&#39;</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p>Throws <code>InvalidAgentDefinitionError</code> for an empty <code>appId</code>, a key that is no RSA private key, an empty webhook secret, an <code>installationId</code> that is no positive integer, a <code>baseUrl</code> that is no absolute https URL without query (empty means <code>https://api.github.com</code>) and a <code>slug</code> that is not the App&#39;s lower-case slug (<code>^[a-z0-9]+(-[a-z0-9]+)*$</code>, as in the App&#39;s URL; a miscased one would silently disable the self guard).</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ToolSet } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;ai&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { PaginatedOctokit } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;./helpers.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubAppOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    appId: string | number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** PEM (PKCS#1 or PKCS#8); literal &quot;\\n&quot; sequences become newlines. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    privateKey: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Several during a secret rotation; a delivery verifies under any. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    webhookSecret: string | </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** For runs not started by a delivery (cron, http, mcp) and comments on their behalf. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    installationId?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The App&#39;s slug; skips \`GET /app\` for the bot login. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    slug?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default DEFAULT_GITHUB_API_URL (&#39;https://api.github.com&#39;). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    baseUrl?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">    fetch?: </span><span style="color:#FF7B84;">typeof</span><span style="color:#E6DFDE;"> globalThis.fetch;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** An Octokit (\`@octokit/core\` with \`paginate\`). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubOctokit = InstanceType&lt;</span><span style="color:#FF7B84;">typeof</span><span style="color:#E6DFDE;"> PaginatedOctokit&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** GitHub App permissions of a token, e.g. \`{ contents: &#39;write&#39;, workflows: &#39;write&#39; }\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubPermissions = Record&lt;string, </span><span style="color:#E7C58C;">&#39;read&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;write&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A short-lived token of one repository (\`IGithubApp.repositoryToken\`). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubRepositoryToken = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    token: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The App&#39;s bot as a git commit identity. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubBotIdentity = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`&lt;slug&gt;[bot]\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`&lt;bot user id&gt;+&lt;slug&gt;[bot]@users.noreply.github.com\`, which GitHub links to the bot. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    email: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IGithubApp {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> appId: string;</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> installationId?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** An Octokit authenticated as the installation (cached token). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    octokit(installationId: number): Promise&lt;GithubOctokit&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`&lt;slug&gt;[bot]\`, from \`slug\` or one \`GET /app\`; cached, single-flight. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    botLogin(): Promise&lt;string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The bot as a commit identity (\`GET /users/&lt;login&gt;\` for its user id,</span></span>
<span class="line"><span style="color:#958A8B;">     * once; a failure is not cached), e.g. the workspace manager&#39;s \`author\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    botIdentity(): Promise&lt;GithubBotIdentity&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * A token limited to one repository and \`permissions\` (the deferred</span></span>
<span class="line"><span style="color:#958A8B;">     * scoped token of plan 014): the App&#39;s installation on the repository</span></span>
<span class="line"><span style="color:#958A8B;">     * (\`GET /repos/{owner}/{repo}/installation\`), then an exchange with</span></span>
<span class="line"><span style="color:#958A8B;">     * \`repositories: [repo]\`. Cached per repository and permissions until 5</span></span>
<span class="line"><span style="color:#958A8B;">     * minutes before it expires, concurrent callers share one exchange, a</span></span>
<span class="line"><span style="color:#958A8B;">     * failure is not cached. Undefined when the App is not installed there.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repositoryToken(target: { owner: string; repo: string }, options: { permissions: GithubPermissions }): Promise&lt;GithubRepositoryToken | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`sha256=&lt;hex&gt;\` of the raw body under any webhook secret, compared in constant time. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    verifySignature(body: Uint8Array, signature: string | null): boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The read-only tools (\`github_get_issue\`, \`github_search_issues\`, ...), acting as the run&#39;s installation. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readTools(): ToolSet;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The write tools (\`github_add_labels\`, \`github_create_comment\`,</span></span>
<span class="line"><span style="color:#958A8B;">     * \`github_close_issue\`), effect tools applied at most once per run.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    writeTools(): ToolSet;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> GITHUB_REQUEST_ERROR_CODE: </span><span style="color:#E7C58C;">&#39;github_request&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> REPO_PATTERN: string; </span><span style="color:#958A8B;">// &#39;^([\\\\w.-]*[\\\\w-][\\\\w.-]*)/([\\\\w.-]*[\\\\w-][\\\\w.-]*)$&#39;</span></span></code></pre></div><p><code>GITHUB_REQUEST_ERROR_CODE</code> is the <code>code</code> of every failed GitHub request (the tools&#39; errors and the channel&#39;s send failures); <code>REPO_PATTERN</code> is the <code>owner/name</code> rule the tools apply (GitHub&#39;s name characters, each segment with one that is not a dot, so <code>.</code> and <code>..</code> never fold the URL into another API path). Build a <code>RegExp</code> from it.</p><h2 id="githubchannel" tabindex="-1">githubChannel <a class="header-anchor" href="#githubchannel" aria-label="Permalink to &quot;githubChannel&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> githubChannel(options: GithubChannelOptions): GithubChannel; </span><span style="color:#958A8B;">// IChannel with in and out, plus on() and to() bound to its name</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> GITHUB_CHANNEL_NAME: </span><span style="color:#E7C58C;">&#39;github&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> GITHUB_CHANNEL_TIMEOUT_MS: </span><span style="color:#E7C58C;">30_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> COMMENT_BODY_MAX_LENGTH: </span><span style="color:#E7C58C;">60_000</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/** What \`approvalUrl\` gets: ids only, never a token. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubApprovalRef = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    approvalId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubChannelOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    app: IGithubApp;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The channel name; default \`&#39;github&#39;\`. A second instance needs its own. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    name?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Logins mentioned at the top of every comment (without \`@\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    mention?: string | </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * A link to the approval in the chamvi UI, e.g.</span></span>
<span class="line"><span style="color:#958A8B;">     * \`https://&lt;app&gt;/ui/approvals?run=&lt;runId&gt;&amp;approval=&lt;approvalId&gt;\`, where the</span></span>
<span class="line"><span style="color:#958A8B;">     * signed-in owner answers it; it carries no token.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    approvalUrl?: (ref: GithubApprovalRef) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Bound of one comment send; default \`GITHUB_CHANNEL_TIMEOUT_MS\` (30 s). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Bytes a delivery may have (413 above); default 1 MiB. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    bodyLimit?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Receives each agent a delivery could not be dispatched to (a throwing</span></span>
<span class="line"><span style="color:#958A8B;">     * filter or key function, a refused key, a failed dispatch); the delivery</span></span>
<span class="line"><span style="color:#958A8B;">     * is then answered 500. Default \`console.error(&#39;[chamvi]&#39;, error)\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onError?: (error: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The GitHub channel: deliveries \`in\`, issue and pull request comments \`out\`, with \`on()\` and \`to()\` bound to its name. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubChannel = IChannel&lt;ChannelRequest, Response&gt; &amp; GithubSubscriber;</span></span></code></pre></div><p>Every option is checked when <code>githubChannel()</code> is called (<code>InvalidAgentDefinitionError</code>). Register the channel on the engine and list it in <code>createHttpApp({ channels })</code>, which serves its <code>in</code> at <code>POST /channels/&lt;name&gt;</code> (the deliveries: signature, self guard, one run per matching agent, <code>202</code> with a <code>GithubWebhookResult</code>). Its <code>out(message, address)</code> comments on the issue or pull request <code>address</code> names (<code>owner/repo#n</code>, else a <code>ValidationError</code>), deduplicated by the marker <code>effectMarker(message.key)</code>. See <a href="/deployment/github-app">GitHub App</a> for both directions.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The \`202\` answer to a delivery: the run each matching agent got (deduplicated on a redelivery). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubWebhookResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    delivery: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    runs: Array&lt;{</span></span>
<span class="line"><span style="color:#E6DFDE;">        agent: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        deduplicated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="github-on-github-to" tabindex="-1">github.on, github.to <a class="header-anchor" href="#github-on-github-to" aria-label="Permalink to &quot;github.on, github.to&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> github: GithubSubscriber; </span><span style="color:#958A8B;">// github.on(events, options?), github.to({ repo, number }) for the channel named &#39;github&#39;</span></span></code></pre></div><p><code>github.on()</code> throws <code>InvalidAgentDefinitionError</code> without events or for an event that is not <code>name</code> or <code>name.action</code> (lower case letters, digits and underscores, e.g. <code>projects_v2_item.created</code>). <code>github.to({ repo, number })</code> returns the address <code>&lt;owner&gt;/&lt;repo&gt;#&lt;number&gt;</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ChannelSubscription } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The parts of a GitHub webhook body chamvi reads; the rest passes through. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubPayload = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    action?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    installation?: { id: number };</span></span>
<span class="line"><span style="color:#E6DFDE;">    repository?: { full_name: string; [key: string]: unknown };</span></span>
<span class="line"><span style="color:#E6DFDE;">    sender?: {</span></span>
<span class="line"><span style="color:#E6DFDE;">        login: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        type: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        [key: string]: unknown</span></span>
<span class="line"><span style="color:#E6DFDE;">    };</span></span>
<span class="line"><span style="color:#E6DFDE;">    issue?: { number: number; [key: string]: unknown };</span></span>
<span class="line"><span style="color:#E6DFDE;">    pull_request?: { number: number; [key: string]: unknown };</span></span>
<span class="line"><span style="color:#E6DFDE;">    [key: string]: unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The envelope payload of a run the GitHub channel started. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubEvent = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** X-GitHub-Event, e.g. &#39;issues&#39;; not covered by the signature, so never a key on its own. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    action?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** X-GitHub-Delivery; not covered by the signature. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    delivery: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    installationId?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    payload: GithubPayload;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubSubscriptionOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`github:&lt;events joined by &#39;,&#39;&gt;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    id?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Runs after the event match; a delivery it refuses starts no run of this subscription. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    filter?: (event: GithubEvent) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Default: the delivery id (applied by the channel). The signature does not</span></span>
<span class="line"><span style="color:#958A8B;">     * cover that header, so a replayed body under a new id is a new run;</span></span>
<span class="line"><span style="color:#958A8B;">     * derive the key from the content on an exposed endpoint.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    idempotencyKey?: (event: GithubEvent) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> string | undefined;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default: \`&lt;full_name&gt;#&lt;issue|pull_request number&gt;\`, else \`&lt;full_name&gt;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    concurrencyKey?: (event: GithubEvent) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> string | undefined;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** An issue or pull request, for \`github.to()\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubTarget = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`owner/name\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The issue or pull request number. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    number: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Makes GitHub subscriptions and addresses for one channel name. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubSubscriber = {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * A subscription to deliveries of \`events\`: \`&#39;issues&#39;\` (every action) or</span></span>
<span class="line"><span style="color:#958A8B;">     * \`&#39;issues.opened&#39;\`, one or several.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    on(events: string | </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[], options?: GithubSubscriptionOptions): ChannelSubscription&lt;GithubEvent&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The address of an issue or pull request, \`&lt;owner&gt;/&lt;repo&gt;#&lt;number&gt;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    to(target: GithubTarget): string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="tools" tabindex="-1">Tools <a class="header-anchor" href="#tools" aria-label="Permalink to &quot;Tools&quot;">​</a></h2><p><code>gh.readTools()</code> and <code>gh.writeTools()</code> return plain AI SDK <code>ToolSet</code>s; the results are these shapes.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The input of a tool on a repository. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RepoInput = { repo: string };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The input of a tool on an issue or pull request. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> NumberInput = RepoInput &amp; { number: number };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_get_issue\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubIssue = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    number: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    title: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    body: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    state: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    labels: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    author: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    createdAt: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    comments: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    isPullRequest: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_search_issues\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubIssueSearch = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    total: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    items: Array&lt;{</span></span>
<span class="line"><span style="color:#E6DFDE;">        repo: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        number: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">        title: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        state: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** One entry of \`github_list_labels\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubLabel = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    description: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_get_pull_request\`; \`base\` and \`head\` are branch names. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubPullRequest = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    number: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    title: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    body: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    state: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    draft: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    merged: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    base: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    head: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    author: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    changedFiles: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_get_file\` for a file: UTF-8 text, cut at FILE_MAX_CHARS characters. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubFile = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    size: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    content: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_get_file\` for a directory. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubDirectory = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    entries: Array&lt;{</span></span>
<span class="line"><span style="color:#E6DFDE;">        name: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        type: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_get_latest_release\`; \`{ none: true }\` when the repository has no release. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubRelease = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    tag: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    publishedAt: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    body: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">} | { none: true };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** One release of \`github_list_releases\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubReleaseNote = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    tag: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    publishedAt: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    prerelease: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Cut at RELEASE_BODY_MAX_CHARS characters. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    body: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    bodyTruncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_list_releases\`: oldest first; \`truncated\` when more matched than RELEASES_MAX or the pages read did not reach \`from\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubReleaseList = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    releases: GithubReleaseNote[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_compare\`: commits oldest first, both lists capped. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubComparison = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    aheadBy: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    behindBy: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    totalCommits: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    commits: Array&lt;{</span></span>
<span class="line"><span style="color:#E6DFDE;">        sha: string;</span></span>
<span class="line"><span style="color:#958A8B;">        /** The first line, cut at 300 characters. */</span></span>
<span class="line"><span style="color:#E6DFDE;">        message: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        author: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">        date: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    files: Array&lt;{</span></span>
<span class="line"><span style="color:#E6DFDE;">        path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        status: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        additions: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">        deletions: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** True when commits were cut or the files reached GitHub&#39;s cap of 300 (more may exist). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_create_comment\`: the posted (or found) comment. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubComment = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_add_labels\`: every label the issue carries afterwards. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubIssueLabels = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    labels: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`github_close_issue\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubClosedIssue = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    number: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    state: </span><span style="color:#E7C58C;">&#39;closed&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stateReason: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="git-credentials" tabindex="-1">Git credentials <a class="header-anchor" href="#git-credentials" aria-label="Permalink to &quot;Git credentials&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> githubAppCredentials(app: IGithubApp, options?: GithubAppCredentialsOptions): IGithubGitCredentials;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> DEFAULT_GITHUB_GIT_HOST: </span><span style="color:#E7C58C;">&#39;github.com&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> GITHUB_TOKEN_USERNAME: </span><span style="color:#E7C58C;">&#39;x-access-token&#39;</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p>The workspace manager&#39;s <code>credentials</code> source for the App (typed structurally against <code>@chamvi/sandbox</code>&#39;s <code>IGitCredentials</code>, which this package does not depend on): for a request of its <code>host</code> (default <code>github.com</code>) and an <code>owner/name</code> path it answers <code>app.repositoryToken()</code> as <code>x-access-token</code>, with <code>contents: read</code> for read and <code>contents: write</code> plus <code>options.permissions</code> for write; nothing for another host, the host itself or a repository the App is not installed on, so the next source (or an anonymous call) follows. Throws <code>InvalidAgentDefinitionError</code> for an app without <code>repositoryToken</code>, permissions that are not <code>read</code> or <code>write</code> and a host that is no host name. <code>app.repositoryToken({ owner, repo }, { permissions })</code> finds the installation (<code>GET /repos/{owner}/{repo}/installation</code>, a 404 answers <code>undefined</code>) and exchanges a token with <code>repositories: [repo]</code>, cached per installation, repository and permissions until 5 minutes before it expires (one exchange for concurrent callers, failures not cached); <code>app.botIdentity()</code> is <code>{ name: &#39;&lt;slug&gt;[bot]&#39;, email: &#39;&lt;user id&gt;+&lt;slug&gt;[bot]@users.noreply.github.com&#39; }</code> (one public <code>GET /users/&lt;login&gt;</code>), for the manager&#39;s <code>author</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { GithubPermissions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../app/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * What a git credential source is asked (structurally the</span></span>
<span class="line"><span style="color:#958A8B;"> * \`GitCredentialRequest\` of \`@chamvi/sandbox\`, which this package does not</span></span>
<span class="line"><span style="color:#958A8B;"> * depend on).</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubGitCredentialRequest = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Lower case, with the port when the URL names one. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    host: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`owner/name\`; empty for the host itself. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    access: </span><span style="color:#E7C58C;">&#39;read&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;write&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Structurally \`@chamvi/sandbox\`&#39;s \`GitCredential\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubGitCredential = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    username: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    password: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt?: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Structurally \`@chamvi/sandbox\`&#39;s \`IGitCredentials\`: pass it as the workspace manager&#39;s \`credentials\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IGithubGitCredentials {</span></span>
<span class="line"><span style="color:#E6DFDE;">    get(input: GithubGitCredentialRequest): Promise&lt;GithubGitCredential | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GithubAppCredentialsOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Added to write tokens (\`contents: write\` always), e.g.</span></span>
<span class="line"><span style="color:#958A8B;">     * \`{ workflows: &#39;write&#39; }\` to push changes under \`.github/workflows\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    permissions?: GithubPermissions;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The git host the App serves; default \`github.com\` (a GitHub Enterprise Server host otherwise). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    host?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="context" tabindex="-1">Context <a class="header-anchor" href="#context" aria-label="Permalink to &quot;Context&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> provideGithubContext(provider: IContextProvider, app: IGithubApp): void; </span><span style="color:#958A8B;">// engine.provide under the key &#39;github&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> injectGithubContext(ctx: ToolContext): IGithubApp;                    </span><span style="color:#958A8B;">// else ContextNotProvidedError</span></span></code></pre></div><p><code>githubModule()</code> provides its app; with a hand-built engine call <code>provideGithubContext(engine, gh)</code> after <code>new Engine()</code>. Inject in a tools factory (<code>tools: (ctx) =&gt; injectGithubContext(ctx).readTools()</code>), in a tool&#39;s <code>execute</code> or in an effect hook; see <a href="/guide/tools#context-shared-instances-for-tools">Context</a>. One app per engine: a second provide throws <code>InvalidAgentDefinitionError</code>.</p><h2 id="module" tabindex="-1">Module <a class="header-anchor" href="#module" aria-label="Permalink to &quot;Module&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">// @chamvi/github/module, needs @chamvi/app</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> githubModule(options?: GithubModuleOptions): GithubModule; </span><span style="color:#958A8B;">// name GITHUB_MODULE_NAME &#39;chamvi:github&#39;, .app: IGithubApp</span></span></code></pre></div><p>Reads <code>GITHUB_APP_ID</code>, <code>GITHUB_APP_PRIVATE_KEY</code>, <code>GITHUB_WEBHOOK_SECRET</code> (comma-separated), <code>GITHUB_INSTALLATION_ID</code>, <code>GITHUB_APP_SLUG</code> and <code>GITHUB_API_URL</code> from <code>options.env ?? process.env</code> when it is called, unless <code>options.app</code> is given; explicit options win. <code>setup</code> contributes <code>githubChannel()</code> (<code>options.channel</code>, the approval link from <code>CHAMVI_PUBLIC_URL</code> unless <code>channel.approvalUrl</code> is given, the app&#39;s clock) to the app&#39;s channels, which the http module serves at <code>/channels/&lt;name&gt;</code>, and <code>githubAppCredentials(app, options.credentials)</code> to <code>AppToken.GIT_CREDENTIALS</code>, which <code>sandboxModule()</code> asks after its own sources (<code>credentials: false</code> contributes none), and the <code>engineCreated</code> hook provides <code>.app</code>. <code>@chamvi/app</code> is an optional peer: the main entry never imports it. See <a href="/guide/app#modules">Apps &amp; Modules</a>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
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
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div>`,33)])])}const h=n(p,[["render",o]]);export{E as __pageData,h as default};
