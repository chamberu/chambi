import{_ as n,o as a,c as e,a2 as p}from"./chunks/framework.Di-jvWLj.js";const d=JSON.parse('{"title":"Sandboxes","description":"","frontmatter":{},"headers":[],"relativePath":"reference/sandbox.md","filePath":"reference/sandbox.md","lastUpdated":1792918464000}'),l={name:"reference/sandbox.md"};function o(t,s,c,r,i,y){return a(),e("div",null,[...s[0]||(s[0]=[p(`<h1 id="sandboxes" tabindex="-1">Sandboxes <a class="header-anchor" href="#sandboxes" aria-label="Permalink to &quot;Sandboxes&quot;">​</a></h1><p>The sandbox packages: <code>@chamvi/sandbox</code> (contracts, rules, the workspace manager) and the three providers. See <a href="/guide/workspaces">Workspaces &amp; Coding</a> for the behaviour.</p><h2 id="chamvi-sandbox" tabindex="-1">@chamvi/sandbox <a class="header-anchor" href="#chamvi-sandbox" aria-label="Permalink to &quot;@chamvi/sandbox&quot;">​</a></h2><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/sandbox</span><span style="color:#E7C58C;"> @chamvi/core</span><span style="color:#E7C58C;"> ai</span><span style="color:#E7C58C;"> --save</span></span></code></pre></div><p><code>@chamvi/core</code> and <code>ai</code> are peer dependencies.</p><h3 id="createworkspacemanager" tabindex="-1">createWorkspaceManager <a class="header-anchor" href="#createworkspacemanager" aria-label="Permalink to &quot;createWorkspaceManager&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createWorkspaceManager(options: WorkspaceManagerOptions): IWorkspaceManager;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> MAX_WORKSPACES_PER_RUN: </span><span style="color:#E7C58C;">3</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> GC_INTERVAL_MS: </span><span style="color:#E7C58C;">600_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CLOSE_TIMEOUT_MS: </span><span style="color:#E7C58C;">30_000</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p>Throws <code>InvalidAgentDefinitionError</code> for a provider without <code>create</code> and <code>collectGarbage</code>, an empty <code>image</code>, invalid <code>env</code> or <code>limits</code>, an <code>allowRepo</code> or <code>onError</code> that is no function, a <code>maxWorkspacesPerRun</code> below 1 or a negative <code>gcIntervalMs</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ToolSet } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;ai&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Engine, IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ISandboxProvider, SandboxLimits } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../provider/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IWorkspace } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../workspace/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WorkspaceManagerOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    provider: ISandboxProvider;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Passed to every \`create\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Passed to every \`create\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Passed to every \`create\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: SandboxLimits;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Accept \`file:///absolute/path\` repositories (local development and tests). Default false. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    allowFileRepos?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Narrows the accepted repositories further; gets the normalized URL. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    allowRepo?: (url: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Workspaces one run may hold at once. Default MAX_WORKSPACES_PER_RUN (3). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxWorkspacesPerRun?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Minimum interval between the garbage collections \`acquire\` starts. Default GC_INTERVAL_MS; 0 disables them. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    gcIntervalMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Background failures (disposal, garbage collection). Default console.error. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onError?: (error: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AcquireInput = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`owner/name\`, an https URL, or \`file:///absolute/path\` with \`allowFileRepos\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ref?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CloseOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** How long close() waits for disposals and creates in flight. Default CLOSE_TIMEOUT_MS (30 s). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AcquireResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: IWorkspace;</span></span>
<span class="line"><span style="color:#958A8B;">    /** True when the run already held (or was creating) the workspace of this repository. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    reused: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * Run-scoped workspaces: one per run and repository (or none), created</span></span>
<span class="line"><span style="color:#958A8B;"> * through the provider and disposed when the run settles (\`attach\`).</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IWorkspaceManager {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The run&#39;s workspace of \`repo\` (none: the repo-less one), created when</span></span>
<span class="line"><span style="color:#958A8B;">     * missing, expired or gone (\`IWorkspace.disposed\`). Concurrent calls share one create. ValidationError for a</span></span>
<span class="line"><span style="color:#958A8B;">     * repository or ref the rules refuse; SandboxError for another ref of a</span></span>
<span class="line"><span style="color:#958A8B;">     * held repository, a reached per-run cap or a failed create.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    acquire(runId: string, input: AcquireInput): Promise&lt;AcquireResult&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The run&#39;s workspace by id, or its only live one when id is omitted</span></span>
<span class="line"><span style="color:#958A8B;">     * (expired and gone ones are disposed first). SandboxError: unknown,</span></span>
<span class="line"><span style="color:#958A8B;">     * expired or gone (disposed then), none; ValidationError: several and no id.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    get(runId: string, workspaceId?: string): IWorkspace;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Disposes one workspace (SandboxError /not found/ for an id the run does</span></span>
<span class="line"><span style="color:#958A8B;">     * not hold, like get), or all of the run (never rejects for none); the</span></span>
<span class="line"><span style="color:#958A8B;">     * latter aborts the run&#39;s creates in flight and waits for them.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    release(runId: string, workspaceId?: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Disposes a run&#39;s workspaces on completed | failed | cancelled. Returns the</span></span>
<span class="line"><span style="color:#958A8B;">     * unsubscribe; after close() it subscribes nothing.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    attach(engine: Pick&lt;Engine, </span><span style="color:#E7C58C;">&#39;on&#39;</span><span style="color:#E6DFDE;">&gt;): () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`create_workspace\` and \`dispose_workspace\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    tools(): ToolSet;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Disposes the manager&#39;s expired workspaces, then runs the provider&#39;s collection; returns how many went. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    collectGarbage(): Promise&lt;number&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Unsubscribes every attach, aborts the creates in flight and disposes</span></span>
<span class="line"><span style="color:#958A8B;">     * every workspace, waiting for both, for disposals started earlier and for</span></span>
<span class="line"><span style="color:#958A8B;">     * the creates in flight of runs released before (call after engine.drain()); afterwards</span></span>
<span class="line"><span style="color:#958A8B;">     * acquire rejects and attach subscribes nothing. Resolves after \`timeoutMs\`</span></span>
<span class="line"><span style="color:#958A8B;">     * at the latest, reporting what is still being disposed to \`onError\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    close(options?: CloseOptions): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WorkspaceToolResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    root: </span><span style="color:#E7C58C;">&#39;/workspace&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ref: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    commit: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    reused: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> DisposeWorkspaceResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    disposed: true;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h3 id="workspaces-and-providers" tabindex="-1">Workspaces and providers <a class="header-anchor" href="#workspaces-and-providers" aria-label="Permalink to &quot;Workspaces and providers&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What a provider knows about a workspace; \`commit\` is set after the checkout. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WorkspaceInfo = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`ISandboxProvider.name\` of the provider that created it. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    provider: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The normalized repository URL. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ref?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** HEAD after the checkout. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    commit?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    createdAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ExecOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Relative to the workspace root or under \`/workspace/\`; default the root. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cwd?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`EXEC_TIMEOUT_MS\`, at most \`EXEC_TIMEOUT_MAX_MS\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdin?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ExecResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** At most \`OUTPUT_MAX_BYTES\` bytes of UTF-8. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdout: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderr: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdoutTruncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderrTruncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    timedOut: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    durationMs: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * A disposable directory a run executes commands in. Exec takes argv only,</span></span>
<span class="line"><span style="color:#958A8B;"> * never a shell string.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IWorkspace {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> id: string;</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> info: WorkspaceInfo;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * True after \`dispose()\`, or once the workspace found its container, pod</span></span>
<span class="line"><span style="color:#958A8B;">     * or directory gone (stopped, killed or removed outside chamvi). Every</span></span>
<span class="line"><span style="color:#958A8B;">     * call then rejects with SandboxError; the manager drops such a workspace</span></span>
<span class="line"><span style="color:#958A8B;">     * and disposes it, which removes what is left of it.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> disposed: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    exec(argv: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[], options?: ExecOptions): Promise&lt;ExecResult&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** UTF-8 text of at most \`FILE_MAX_BYTES\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readFile(path: string): Promise&lt;string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    writeFile(path: string, content: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Idempotent. Every call after it rejects with SandboxError. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    dispose(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IWorkspace } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../workspace/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SandboxLimits = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Kubernetes quantity, e.g. \`&#39;1&#39;\`, \`&#39;500m&#39;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cpu?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Bytes as a Kubernetes quantity, e.g. \`&#39;2Gi&#39;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    memory?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Disk of \`/workspace\`, e.g. \`&#39;4Gi&#39;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    storage?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    pids?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Lifetime of the workspace. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WorkspaceCreateOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A normalized repository URL (\`normalizeRepo\`); without it the workspace is only \`git init\`-ed. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ref?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: SandboxLimits;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ISandboxProvider {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> name: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * A ready workspace (id \`randomUUID()\`), checked out when \`repo\` is given</span></span>
<span class="line"><span style="color:#958A8B;">     * (via \`prepareWorkspace\`, then \`info.commit = commit\`).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    create(options: WorkspaceCreateOptions): Promise&lt;IWorkspace&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Deletes this provider&#39;s workspaces past their expiry; returns how many.</span></span>
<span class="line"><span style="color:#958A8B;">     * One that cannot be removed never keeps the others: the pass goes on and</span></span>
<span class="line"><span style="color:#958A8B;">     * rejects with one SandboxError at the end.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    collectGarbage(): Promise&lt;number&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The workspace root as the model sees it, on every provider. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> WORKSPACE_ROOT = </span><span style="color:#E7C58C;">&#39;/workspace&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Cap per output stream of one exec. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> OUTPUT_MAX_BYTES = </span><span style="color:#E7C58C;">65_536</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Cap of \`readFile\` and \`writeFile\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> FILE_MAX_BYTES = </span><span style="color:#E7C58C;">1_048_576</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> EXEC_TIMEOUT_MS = </span><span style="color:#E7C58C;">300_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> EXEC_TIMEOUT_MAX_MS = </span><span style="color:#E7C58C;">1_800_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The whole environment of a container or pod workspace (plus the configured</span></span>
<span class="line"><span style="color:#958A8B;"> * \`env\`). \`safe.directory\` because \`/workspace\` is a root-owned volume.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> SANDBOX_ENV: Readonly&lt;Record&lt;string, string&gt;&gt; = Object.freeze({</span></span>
<span class="line"><span style="color:#E6DFDE;">    HOME: </span><span style="color:#E7C58C;">&#39;/tmp&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    GIT_TERMINAL_PROMPT: </span><span style="color:#E7C58C;">&#39;0&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    GIT_CONFIG_NOSYSTEM: </span><span style="color:#E7C58C;">&#39;1&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    GIT_CONFIG_COUNT: </span><span style="color:#E7C58C;">&#39;1&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    GIT_CONFIG_KEY_0: </span><span style="color:#E7C58C;">&#39;safe.directory&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    GIT_CONFIG_VALUE_0: WORKSPACE_ROOT,</span></span>
<span class="line"><span style="color:#E6DFDE;">    NPM_CONFIG_UPDATE_NOTIFIER: </span><span style="color:#E7C58C;">&#39;false&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    CI: </span><span style="color:#E7C58C;">&#39;true&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">});</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { SandboxLimits } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;./types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> DEFAULT_LIMITS: Readonly&lt;Required&lt;SandboxLimits&gt;&gt; = Object.freeze({</span></span>
<span class="line"><span style="color:#E6DFDE;">    cpu: </span><span style="color:#E7C58C;">&#39;1&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    memory: </span><span style="color:#E7C58C;">&#39;2Gi&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    storage: </span><span style="color:#E7C58C;">&#39;4Gi&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    pids: </span><span style="color:#E7C58C;">512</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs: </span><span style="color:#E7C58C;">1_800_000</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">});</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> DEFAULT_SANDBOX_IMAGE = </span><span style="color:#E7C58C;">&#39;ghcr.io/chamvi/sandbox-node:24&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Size of the \`/tmp\` tmpfs of a container or pod workspace. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> TMP_SIZE = </span><span style="color:#E7C58C;">&#39;512Mi&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Labels every container or pod workspace carries. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> SANDBOX_LABELS: Readonly&lt;Record&lt;string, string&gt;&gt; = Object.freeze({</span></span>
<span class="line"><span style="color:#E7C58C;">    &#39;app.kubernetes.io/managed-by&#39;</span><span style="color:#E6DFDE;">: </span><span style="color:#E7C58C;">&#39;chamvi&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E7C58C;">    &#39;app.kubernetes.io/component&#39;</span><span style="color:#E6DFDE;">: </span><span style="color:#E7C58C;">&#39;sandbox&#39;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">});</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`SANDBOX_LABELS\` as \`key=value\` selectors: a Docker label filter, joined by \`,\` a Kubernetes label selector. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> SANDBOX_LABEL_SELECTORS: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[] = Object.freeze(Object.entries(SANDBOX_LABELS).map(([key, value]) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E7C58C;"> \`</span><span style="color:#E6DFDE;">\${</span><span style="color:#E7C58C;">key</span><span style="color:#E6DFDE;">}</span><span style="color:#E7C58C;">=</span><span style="color:#E6DFDE;">\${</span><span style="color:#E7C58C;">value</span><span style="color:#E6DFDE;">}</span><span style="color:#E7C58C;">\`</span><span style="color:#E6DFDE;">));</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> RUN_LABEL = </span><span style="color:#E7C58C;">&#39;chamvi.dev/run&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> WORKSPACE_LABEL = </span><span style="color:#E7C58C;">&#39;chamvi.dev/workspace&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Expiry in epoch milliseconds: a Docker label, a Kubernetes annotation. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> EXPIRES_AT_KEY = </span><span style="color:#E7C58C;">&#39;chamvi.dev/expires-at&#39;</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><h3 id="rules" tabindex="-1">Rules <a class="header-anchor" href="#rules" aria-label="Permalink to &quot;Rules&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> normalizeRepo(input: string, options?: NormalizeRepoOptions): string;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertGitRef(ref: string): void;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> resolveWorkspacePath(path: string): string;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> resolveLimits(...layers: Array&lt;SandboxLimits | undefined&gt;): Required&lt;SandboxLimits&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> parseCpu(value: string): number;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> parseMemory(value: string): number;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertSandboxEnv(env: Record&lt;string, string&gt; | undefined): void;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> prepareWorkspace(workspace: IWorkspace, input: { repo?: string; ref?: string; signal?: AbortSignal }): Promise&lt;{ commit?: string }&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createOutputCollector(maxBytes: number): IOutputCollector;</span></span></code></pre></div><p><code>normalizeRepo</code>, <code>assertGitRef</code> and <code>resolveWorkspacePath</code> throw <code>ValidationError</code> (model input); <code>resolveLimits</code>, <code>parseCpu</code>, <code>parseMemory</code> and <code>assertSandboxEnv</code> throw <code>InvalidAgentDefinitionError</code> (configuration); <code>prepareWorkspace</code> throws <code>SandboxError</code> with git&#39;s stderr when a checkout step fails.</p><h3 id="remote-workspaces" tabindex="-1">Remote workspaces <a class="header-anchor" href="#remote-workspaces" aria-label="Permalink to &quot;Remote workspaces&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createRemoteWorkspace(input: RemoteWorkspaceInput): IWorkspace;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> TIMEOUT_KILL_AFTER_SECONDS: </span><span style="color:#E7C58C;">5</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> EXEC_GRACE_MS: </span><span style="color:#E7C58C;">15_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> ALIVE_PROBE_TIMEOUT_MS: </span><span style="color:#E7C58C;">5_000</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p>A provider that can run argv in a container implements <code>IExecTransport</code>: it runs argv, streams stdout and stderr into the sinks it is given and resolves the exit code. <code>createRemoteWorkspace</code> adds the rest: the <code>sh -c</code> script that enters the working directory, runs the command behind the timeout wrapper and reports its exit on stderr (so an exec returns about 2 s after the command exited, even when a background job holds its output), the guard, path checks, output caps, file reads and writes, dispose. After a failed exec it asks <code>alive()</code> (at most <code>ALIVE_PROBE_TIMEOUT_MS</code>); <code>false</code> marks the workspace gone (<code>disposed</code>).</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IOutputSink } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../output/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { WorkspaceInfo } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../workspace/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> TransportExecOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdin?: Uint8Array;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Gets every stdout chunk as it arrives; the workspace caps and keeps it. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdout: IOutputSink;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Gets every stderr chunk as it arrives; the workspace caps and keeps it. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderr: IOutputSink;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Aborted on a caller abort, a dispose, the client-side guard, or once the</span></span>
<span class="line"><span style="color:#958A8B;">     * workspace settled the exec itself (the command exited, a background job</span></span>
<span class="line"><span style="color:#958A8B;">     * still holds its output): stop waiting and detach.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> TransportExecResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * Runs argv in one container or pod. The remote workspace wraps argv itself</span></span>
<span class="line"><span style="color:#958A8B;"> * (the working directory, GNU \`timeout\`, the exit status reported on</span></span>
<span class="line"><span style="color:#958A8B;"> * stderr); a transport only executes and streams the output.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IExecTransport {</span></span>
<span class="line"><span style="color:#958A8B;">    /** A command that cannot start reports exit 127. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    exec(argv: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[], options: TransportExecOptions): Promise&lt;TransportExecResult&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Whether the container or pod still runs; asked after a failed exec. False</span></span>
<span class="line"><span style="color:#958A8B;">     * marks the workspace gone. A rejection, or no answer within</span></span>
<span class="line"><span style="color:#958A8B;">     * \`ALIVE_PROBE_TIMEOUT_MS\` (the signal then aborts), reads as alive.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    alive?(signal: AbortSignal): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Deletes the container or pod; idempotent, a missing one is fine. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    remove(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RemoteWorkspaceInput = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`randomUUID()\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A mutable object the provider owns (it sets \`commit\` after the checkout). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    info: WorkspaceInfo;</span></span>
<span class="line"><span style="color:#E6DFDE;">    transport: IExecTransport;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`systemClock\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h3 id="context" tabindex="-1">Context <a class="header-anchor" href="#context" aria-label="Permalink to &quot;Context&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> provideSandboxContext(provider: IContextProvider, manager: IWorkspaceManager): void; </span><span style="color:#958A8B;">// engine.provide under the key &#39;sandbox&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> injectSandboxContext(ctx: ToolContext): IWorkspaceManager;                         </span><span style="color:#958A8B;">// else ContextNotProvidedError</span></span></code></pre></div><p><code>sandboxModule()</code> provides its manager; with a hand-built engine call <code>provideSandboxContext(engine, manager)</code> after <code>new Engine()</code>. A tools factory then builds the workspace and coding tools per execution: <code>tools: (ctx) =&gt; { const manager = injectSandboxContext(ctx); return { ...manager.tools(), ...codingTools(manager) }; }</code>. See <a href="/guide/tools#context-shared-instances-for-tools">Context</a>.</p><h3 id="module" tabindex="-1">Module <a class="header-anchor" href="#module" aria-label="Permalink to &quot;Module&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">// @chamvi/sandbox/module, needs @chamvi/app</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> sandboxModule(options?: SandboxModuleOptions): SandboxModule; </span><span style="color:#958A8B;">// name SANDBOX_MODULE_NAME &#39;chamvi:sandbox&#39;, .manager: IWorkspaceManager</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> SANDBOX_PROVIDER_NAMES: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> SandboxProviderName[]; </span><span style="color:#958A8B;">// [&#39;local&#39;, &#39;docker&#39;, &#39;kubernetes&#39;]</span></span></code></pre></div><p>The provider is <code>CHAMVI_SANDBOX_PROVIDER</code>, else <code>options.provider</code>, else <code>local</code>, read from <code>options.env ?? process.env</code> when the factory is called; <code>CHAMVI_SANDBOX_NAMESPACE</code> and <code>CHAMVI_SANDBOX_IMAGE</code> win over the options too. In start and job mode <code>setup</code> imports the provider package (<code>@chamvi/sandbox-local</code>, <code>@chamvi/sandbox-docker</code> or <code>@chamvi/sandbox-k8s</code>, installed beside <code>@chamvi/sandbox</code> and resolved from there; they are no declared peers, since every provider depends on <code>@chamvi/sandbox</code> and release-please refuses the cycle; a missing one throws <code>InvalidAgentDefinitionError</code> naming it, and under a strict layout that hides undeclared packages (Yarn PnP, pnpm with <code>hoist=false</code>) pass a built provider as <code>options.provider</code>), and the lifecycle hooks attach the manager to the engine, provide it (<code>engineCreated</code>) and close it after the engine drained; migrate mode does nothing. <code>@chamvi/app</code> is an optional peer: the main entry never imports it.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SandboxProviderName = </span><span style="color:#E7C58C;">&#39;local&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;docker&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;kubernetes&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * \`createWorkspaceManager()\` options; the manager&#39;s \`env\` is \`workspaceEnv\`</span></span>
<span class="line"><span style="color:#958A8B;"> * here, since \`env\` is the process env the factory reads.</span></span>
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
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="chamvi-sandbox-local" tabindex="-1">@chamvi/sandbox-local <a class="header-anchor" href="#chamvi-sandbox-local" aria-label="Permalink to &quot;@chamvi/sandbox-local&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createLocalSandbox(options?: LocalSandboxOptions): ISandboxProvider; </span><span style="color:#958A8B;">// name &#39;local&#39;</span></span></code></pre></div><p>No isolation: development and tests only. Workspaces are folders under <code>root</code> (default <code>&lt;os tmpdir&gt;/chamvi-workspaces</code>); of the limits only <code>timeoutMs</code> applies.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { SandboxLimits, WorkspaceInfo } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> LocalSandboxOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Directory holding one folder per workspace. Default \`join(os.tmpdir(), &#39;chamvi-workspaces&#39;)\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    root?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Added to every workspace&#39;s environment (after the defaults, so it wins). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The only limit local enforces: the workspace lifetime (expiry). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: Pick&lt;SandboxLimits, </span><span style="color:#E7C58C;">&#39;timeoutMs&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What \`LocalWorkspace\` is built from (internal). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> LocalWorkspaceInput = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The workspace folder \`&lt;root&gt;/&lt;id&gt;\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    dir: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    info: WorkspaceInfo;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock: IClock;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Called once when the workspace starts disposing. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onDispose: () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="chamvi-sandbox-docker" tabindex="-1">@chamvi/sandbox-docker <a class="header-anchor" href="#chamvi-sandbox-docker" aria-label="Permalink to &quot;@chamvi/sandbox-docker&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createDockerSandbox(options?: DockerSandboxOptions): ISandboxProvider; </span><span style="color:#958A8B;">// name &#39;docker&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> DEFAULT_NETWORK: </span><span style="color:#E7C58C;">&#39;bridge&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CONTAINER_NAME_PREFIX: </span><span style="color:#E7C58C;">&#39;chamvi-ws-&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> SANDBOX_USER: </span><span style="color:#E7C58C;">&#39;1000:1000&#39;</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p>One container per workspace, removed with its volume on dispose. Creating the provider contacts nothing.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { SandboxLimits } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Dockerode </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;dockerode&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> DockerSandboxOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The Docker client; default \`new Docker()\` (\`DOCKER_HOST\` or \`/var/run/docker.sock\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    docker?: Dockerode;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`DEFAULT_SANDBOX_IMAGE\`; pin a digest in production. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Default \`DEFAULT_NETWORK\` (\`&#39;bridge&#39;\`); \`&#39;none&#39;\` (repo-less workspaces only,</span></span>
<span class="line"><span style="color:#958A8B;">     * the clone runs inside) or any user-created network name, passed through.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    network?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * \`&#39;missing&#39;\` (default) pulls once when the image is not present, \`&#39;always&#39;\`</span></span>
<span class="line"><span style="color:#958A8B;">     * before every create (a mutable tag then follows its rebuilds), \`&#39;never&#39;\` never.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    pull?: </span><span style="color:#E7C58C;">&#39;missing&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;always&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;never&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Added to every workspace&#39;s environment, after \`SANDBOX_ENV\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: SandboxLimits;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ContainerOptionsInput = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    image: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    network: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits: Required&lt;SandboxLimits&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="chamvi-sandbox-k8s" tabindex="-1">@chamvi/sandbox-k8s <a class="header-anchor" href="#chamvi-sandbox-k8s" aria-label="Permalink to &quot;@chamvi/sandbox-k8s&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createKubernetesSandbox(options: KubernetesSandboxOptions): ISandboxProvider; </span><span style="color:#958A8B;">// name &#39;k8s&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createPodClient(input: CreatePodClientInput): IPodClient;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CONTAINER_NAME: </span><span style="color:#E7C58C;">&#39;sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> POD_NAME_PREFIX: </span><span style="color:#E7C58C;">&#39;chamvi-ws-&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> START_TIMEOUT_MS: </span><span style="color:#E7C58C;">120_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> POLL_MS: </span><span style="color:#E7C58C;">1_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> FATAL_WAITING_REASONS: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];</span></span></code></pre></div><p>One pod per workspace. The Role needs <code>pods</code> <code>create</code>, <code>get</code>, <code>list</code>, <code>delete</code> and <code>pods/exec</code> <code>get</code> and <code>create</code> in the sandbox namespace. See <a href="/deployment/kubernetes#sandboxes-in-the-cluster">Kubernetes &amp; Flux</a>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { KubeConfig } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@kubernetes/client-node&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { SandboxLimits } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IPodClient } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../client/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ImagePullPolicy = </span><span style="color:#E7C58C;">&#39;Always&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;IfNotPresent&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> KubernetesSandboxOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Namespace of the workspace pods (required). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    namespace: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`new KubeConfig()\` with \`loadFromDefault()\` (in-cluster or \`KUBECONFIG\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    kubeConfig?: KubeConfig;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`DEFAULT_SANDBOX_IMAGE\`; pin a digest in production. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Added to every workspace&#39;s environment, after \`SANDBOX_ENV\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: SandboxLimits;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Extra pod labels (e.g. for a NetworkPolicy); may not name a managed label. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    podLabels?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`&#39;IfNotPresent&#39;\`; \`&#39;Always&#39;\` for a mutable tag. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    imagePullPolicy?: ImagePullPolicy;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`START_TIMEOUT_MS\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    startTimeoutMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`POLL_MS\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    pollMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Test seam; default \`createPodClient({ kubeConfig, namespace })\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    client?: IPodClient;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PodInput = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    namespace: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    image: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits: Required&lt;SandboxLimits&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: Date;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The \`podLabels\`; the managed labels win. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    labels: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    imagePullPolicy: ImagePullPolicy;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Writable } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;node:stream&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    CoreV1Api,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Exec,</span></span>
<span class="line"><span style="color:#E6DFDE;">    KubeConfig,</span></span>
<span class="line"><span style="color:#E6DFDE;">    V1Pod,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@kubernetes/client-node&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PodExecInput = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    argv: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Written to the command; closed only on the \`v5.channel.k8s.io\` protocol. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdin?: Uint8Array;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdout: Writable;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderr: Writable;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Closes the socket: the command runs on until its \`timeout\` or the pod&#39;s deletion. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The pod operations the Kubernetes sandbox needs, in one namespace. Every</span></span>
<span class="line"><span style="color:#958A8B;"> * failure is a \`SandboxError\`; deleting a missing pod is fine.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IPodClient {</span></span>
<span class="line"><span style="color:#E6DFDE;">    create(pod: V1Pod): Promise&lt;V1Pod&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    read(name: string): Promise&lt;V1Pod&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Without a grace period; a missing pod is fine. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    delete(name: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    list(labelSelector: string): Promise&lt;V1Pod[]&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Runs argv in the pod&#39;s sandbox container; the exit code from the exec status. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    exec(name: string, input: PodExecInput): Promise&lt;{ exitCode: number }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CreatePodClientInput = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    kubeConfig: KubeConfig;</span></span>
<span class="line"><span style="color:#E6DFDE;">    namespace: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PodClientParts = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    core: Pick&lt;CoreV1Api, </span><span style="color:#E7C58C;">&#39;createNamespacedPod&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;readNamespacedPod&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;deleteNamespacedPod&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;listNamespacedPod&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    exec: Pick&lt;Exec, </span><span style="color:#E7C58C;">&#39;exec&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    namespace: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The part of the exec WebSocket the client uses. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ExecSocket = {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> protocol: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    close(): void;</span></span>
<span class="line"><span style="color:#E6DFDE;">    on(event: </span><span style="color:#E7C58C;">&#39;close&#39;</span><span style="color:#E6DFDE;">, listener: () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void): unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">    on(event: </span><span style="color:#E7C58C;">&#39;error&#39;</span><span style="color:#E6DFDE;">, listener: (error: Error) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void): unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div>`,41)])])}const D=n(l,[["render",o]]);export{d as __pageData,D as default};
