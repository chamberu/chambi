import{_ as n,o as a,c as e,a2 as o}from"./chunks/framework.Di-jvWLj.js";const E=JSON.parse('{"title":"Sandboxes","description":"","frontmatter":{},"headers":[],"relativePath":"reference/sandbox.md","filePath":"reference/sandbox.md","lastUpdated":1793360400000}'),l={name:"reference/sandbox.md"};function p(t,s,c,r,i,d){return a(),e("div",null,[...s[0]||(s[0]=[o(`<h1 id="sandboxes" tabindex="-1">Sandboxes <a class="header-anchor" href="#sandboxes" aria-label="Permalink to &quot;Sandboxes&quot;">​</a></h1><p>The sandbox packages: <code>@chamvi/sandbox</code> (contracts, rules, the workspace manager) and the three providers. See <a href="/guide/workspaces">Workspaces &amp; Coding</a> for the behaviour.</p><h2 id="chamvi-sandbox" tabindex="-1">@chamvi/sandbox <a class="header-anchor" href="#chamvi-sandbox" aria-label="Permalink to &quot;@chamvi/sandbox&quot;">​</a></h2><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/sandbox</span><span style="color:#E7C58C;"> @chamvi/core</span><span style="color:#E7C58C;"> ai</span><span style="color:#E7C58C;"> --save</span></span></code></pre></div><p><code>@chamvi/core</code> and <code>ai</code> are peer dependencies.</p><h3 id="createworkspacemanager" tabindex="-1">createWorkspaceManager <a class="header-anchor" href="#createworkspacemanager" aria-label="Permalink to &quot;createWorkspaceManager&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createWorkspaceManager(options: WorkspaceManagerOptions): IWorkspaceManager;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> MAX_WORKSPACES_PER_RUN: </span><span style="color:#E7C58C;">3</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> GC_INTERVAL_MS: </span><span style="color:#E7C58C;">600_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CLOSE_TIMEOUT_MS: </span><span style="color:#E7C58C;">30_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CREDENTIAL_INSTALL_TIMEOUT_MS: </span><span style="color:#E7C58C;">30_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> PUSH_LOG_MAX_COMMITS: </span><span style="color:#E7C58C;">50</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p>Throws <code>InvalidAgentDefinitionError</code> for a provider without <code>create</code>, <code>find</code> and <code>collectGarbage</code>, an empty <code>image</code>, invalid <code>env</code> or <code>limits</code>, a <code>deployment</code> that is no label value, an <code>allowRepo</code>, <code>allowImage</code>, <code>isSettled</code> or <code>onError</code> that is no function, a <code>maxWorkspacesPerRun</code> below 1, a negative <code>gcIntervalMs</code>, <code>credentials</code> that are no sources with <code>get()</code>, a <code>depth</code> below 1, an <code>author</code> without a non-empty <code>name</code> and <code>email</code> (no line break, <code>&lt;</code> or <code>&gt;</code>) or a malformed <code>push</code>.</p><p>With <code>credentials</code> the manager looks up a read credential for every checkout (<code>checkout.credential</code> of the create; a failing source fails the create with a <code>SandboxError</code> naming the repository) and hands out each workspace through a view whose exec results, file reads and errors carry <code>[redacted]</code> in place of every issued token and whose <code>redact(text)</code> does the same for text a tool decodes itself. Only the tokens this process issued are redacted, each until <code>REDACT_GRACE_MS</code> after its <code>expiresAt</code> (a static token without expiry stays); the credentials file of a workspace found again (after a restart or on another replica) is never read back, since the model can write it. The view also has <code>readFileRaw(path)</code>, the unredacted text, and <code>redactedSpans(text)</code>, which the edit tools use: they match oldString against the redacted text the model read (<code>redactedSpans</code>), refuse an edit that touches a <code>[redacted]</code> span and put every untouched token back byte for byte, so an oldString can neither probe a token nor write <code>[redacted]</code> back. Without an image allow-list (<code>allowImage</code>), and on the local provider, <code>create_workspace</code> has no <code>image</code> parameter and a requested image is a <code>ValidationError</code> before any create. It writes the credential helper and the credentials file of an https workspace after the create and before the first exec of a workspace this process has not written yet (one found again), and again before an exec once a token expires within <code>CREDENTIAL_REFRESH_MS</code> (at most once per <code>CREDENTIAL_RETRY_MS</code> while a source keeps answering a token inside that window); a failing write goes to <code>onError</code> and is tried again <code>CREDENTIAL_RETRY_MS</code> later, never failing the exec. The file holds the repository&#39;s write credential (else its read one, also when the write lookup fails, which goes to <code>onError</code>) and the host&#39;s (a request with an empty <code>path</code>).</p><p>On a miss (<code>get</code> without a held workspace that fits, <code>acquire</code> of a repository it does not hold) the manager asks <code>provider.find(runId, { deployment })</code> once per run at a time and adopts what it finds, so a run reaches its workspaces after a restart or on another replica. <code>release(runId)</code> (and <code>attach</code> for a settled run) disposes the held workspaces and every one <code>find</code> reports; with <code>isSettled</code>, <code>attach</code> skips the <code>find</code> for a settled run this process neither holds nor looks up and starts a garbage collection instead (at most one per <code>gcIntervalMs</code>), which removes what other processes left for it; <code>close()</code> disposes nothing a live run holds, <code>close({ dispose: true })</code> disposes those too.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ToolSet } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;ai&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock, IEngine, ToolContext } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    GitAccess,</span></span>
<span class="line"><span style="color:#E6DFDE;">    GitCredential,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IGitCredentials,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Redactor,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../credentials/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { RepositoryInstructions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../instructions/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ISandboxProvider, SandboxLimits } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../provider/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IWorkspace } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../workspace/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The credential handling of one manager; only built when it has credential sources. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CredentialSupport = {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> redactor: Redactor;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The first credential the sources answer for an https \`url\` (redacted</span></span>
<span class="line"><span style="color:#958A8B;">     * from then on), else undefined; undefined for a \`file://\` repository.</span></span>
<span class="line"><span style="color:#958A8B;">     * SandboxError for a failing source.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    lookup(url: string, access: GitAccess, runId: string, signal?: AbortSignal): Promise&lt;GitCredential | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Writes the credentials file of \`workspace\` (raw,</span></span>
<span class="line"><span style="color:#958A8B;">     * not wrapped) when it has none from this process yet, or one of its</span></span>
<span class="line"><span style="color:#958A8B;">     * credentials expires within \`CREDENTIAL_REFRESH_MS\`: the repository&#39;s</span></span>
<span class="line"><span style="color:#958A8B;">     * write credential, else (none, or a failing write lookup, reported to</span></span>
<span class="line"><span style="color:#958A8B;">     * \`onError\`) its read credential. A credential already inside that</span></span>
<span class="line"><span style="color:#958A8B;">     * window is rewritten \`CREDENTIAL_RETRY_MS\` later at the earliest. A failure goes to</span></span>
<span class="line"><span style="color:#958A8B;">     * \`onError\` and is retried \`CREDENTIAL_RETRY_MS\` later; it never throws.</span></span>
<span class="line"><span style="color:#958A8B;">     * A workspace this process created anonymously (\`fresh\`) holds no file</span></span>
<span class="line"><span style="color:#958A8B;">     * yet; one whose checkout was authenticated holds the read credential,</span></span>
<span class="line"><span style="color:#958A8B;">     * and one it found again may hold an earlier process&#39;s: the first</span></span>
<span class="line"><span style="color:#958A8B;">     * install overwrites (or clears) both. The file is never read back: it</span></span>
<span class="line"><span style="color:#958A8B;">     * is writable from inside the workspace, so its content is no secret to</span></span>
<span class="line"><span style="color:#958A8B;">     * redact.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    refresh(workspace: IWorkspace, options?: { fresh?: boolean }): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The workspace the manager hands out: redacting and refreshing before each call. One per raw workspace. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    wrap(workspace: IWorkspace): IWorkspace;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitToolsContext = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    manager: Pick&lt;IWorkspaceManager, </span><span style="color:#E7C58C;">&#39;get&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The credential of an https repository, or undefined (anonymous). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    lookup: (url: string, access: GitAccess, runId: string, signal?: AbortSignal) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;GitCredential | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`normalizeRepo\` with the manager&#39;s rules (\`allowFileRepos\`, \`allowRepo\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    normalize: (repo: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    push: PushPolicy;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
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
<span class="line"><span style="color:#958A8B;">    /** Collect root repository guidance and offer path-scoped guidance tools. Default true. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repositoryInstructions?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The images \`create_workspace\` may ask for; gets the reference as</span></span>
<span class="line"><span style="color:#958A8B;">     * requested. Without it, and on the local provider (it runs no images),</span></span>
<span class="line"><span style="color:#958A8B;">     * \`create_workspace\` has no \`image\` parameter and a requested image is a</span></span>
<span class="line"><span style="color:#958A8B;">     * \`ValidationError\`. Never asked for the manager&#39;s or the provider&#39;s own</span></span>
<span class="line"><span style="color:#958A8B;">     * image.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    allowImage?: (image: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Workspaces one run may hold at once. Default MAX_WORKSPACES_PER_RUN (3). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxWorkspacesPerRun?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Minimum interval between the garbage collections \`acquire\` starts. Default GC_INTERVAL_MS; 0 disables them. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    gcIntervalMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The deployment the workspaces belong to (a label value): \`find\` and the</span></span>
<span class="line"><span style="color:#958A8B;">     * garbage collection only see their own. Default \`DEFAULT_DEPLOYMENT\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    deployment?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * True when a run settled or no longer exists; the garbage collection then</span></span>
<span class="line"><span style="color:#958A8B;">     * disposes its workspaces, also ones another process created. Without</span></span>
<span class="line"><span style="color:#958A8B;">     * it only expired workspaces are collected.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    isSettled?: (runId: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Git credentials for private repositories and pushes: the first source</span></span>
<span class="line"><span style="color:#958A8B;">     * that answers wins, none answering is anonymous.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    credentials?: IGitCredentials | IGitCredentials[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** A shallow checkout of this many commits for huge repositories; default the full history. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    depth?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The commit identity, set as \`GIT_AUTHOR_*\` and \`GIT_COMMITTER_*\` in every workspace&#39;s environment. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    author?: GitAuthor;</span></span>
<span class="line"><span style="color:#958A8B;">    /** What \`git_push\` may push; default every branch but the default branch, no force, no approval. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    push?: PushPolicy;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Background failures (disposal, garbage collection, credential refreshes). Default console.error. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    onError?: (error: unknown) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitAuthor = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    name: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    email: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Applies to git_push only; other tools and shell commands can bypass it. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PushPolicy = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`auto\` (default) pushes; \`approve\` asks the owner through \`approve()\` before every push. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    mode?: </span><span style="color:#E7C58C;">&#39;auto&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;approve&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Allow \`git_push({ force: true })\` (always \`--force-with-lease\`). Default false. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    allowForce?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The branches \`git_push\` may push to; default every branch but the repository&#39;s default branch. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    allowBranch?: (branch: string, ctx: ToolContext) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> boolean | Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The channel an approval goes through; default the run&#39;s source channel when it has an \`out\`, else none (inbox only). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    channel?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> AcquireInput = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`owner/name\`, an https URL, or \`file:///absolute/path\` with \`allowFileRepos\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ref?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * An image reference (\`assertImage\`), only with \`allowImage\` and not on</span></span>
<span class="line"><span style="color:#958A8B;">     * the local provider, checked by \`allowImage\`; default the manager&#39;s,</span></span>
<span class="line"><span style="color:#958A8B;">     * else the provider&#39;s.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CloseOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** How long close() waits for disposals and creates in flight. Default CLOSE_TIMEOUT_MS (30 s). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Also dispose the workspaces of live runs (default false: they stay for</span></span>
<span class="line"><span style="color:#958A8B;">     * their runs to find again). For in-memory run storage, nothing can resume after the process exits.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    dispose?: boolean;</span></span>
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
<span class="line"><span style="color:#958A8B;">     * The run&#39;s workspace of \`repo\` (none: the repo-less one): held, else</span></span>
<span class="line"><span style="color:#958A8B;">     * found through \`provider.find\` (adopted, \`reused\`), else created when</span></span>
<span class="line"><span style="color:#958A8B;">     * missing, expired or gone (\`IWorkspace.disposed\`). Concurrent calls share one create. ValidationError for a</span></span>
<span class="line"><span style="color:#958A8B;">     * repository, ref or image the rules refuse; SandboxError for another ref</span></span>
<span class="line"><span style="color:#958A8B;">     * or image of a held repository, a reached per-run cap or a failed create.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    acquire(runId: string, input: AcquireInput): Promise&lt;AcquireResult&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The run&#39;s workspace by id, or its only live one when id is omitted</span></span>
<span class="line"><span style="color:#958A8B;">     * (expired and gone ones are disposed first). A run that holds none that</span></span>
<span class="line"><span style="color:#958A8B;">     * fits is looked up through \`provider.find\` (one lookup per run at a</span></span>
<span class="line"><span style="color:#958A8B;">     * time) and the found ones adopted. SandboxError: unknown, expired or gone</span></span>
<span class="line"><span style="color:#958A8B;">     * (disposed then), none, a failed lookup; ValidationError: several and no id.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    get(runId: string, workspaceId?: string): Promise&lt;IWorkspace&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Disposes one workspace (SandboxError /not found/ for an id the run does</span></span>
<span class="line"><span style="color:#958A8B;">     * not hold or find, like get), or all of the run (never rejects for none):</span></span>
<span class="line"><span style="color:#958A8B;">     * the held ones and every one \`provider.find\` reports for the run; this</span></span>
<span class="line"><span style="color:#958A8B;">     * aborts the run&#39;s creates and lookups in flight and waits for the creates.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    release(runId: string, workspaceId?: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Disposes a run&#39;s workspaces on completed | failed | cancelled (\`release\`,</span></span>
<span class="line"><span style="color:#958A8B;">     * so also those other processes created). With \`isSettled\`, a run this</span></span>
<span class="line"><span style="color:#958A8B;">     * process neither holds nor looks up is not looked up (no \`provider.find\`</span></span>
<span class="line"><span style="color:#958A8B;">     * per settled run): it starts a garbage collection instead (at most one</span></span>
<span class="line"><span style="color:#958A8B;">     * per \`gcIntervalMs\`), which removes what other processes left for it.</span></span>
<span class="line"><span style="color:#958A8B;">     * Returns the unsubscribe; after close() it subscribes nothing.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    attach(engine: Pick&lt;IEngine, </span><span style="color:#E7C58C;">&#39;on&#39;</span><span style="color:#E6DFDE;">&gt;): () </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> void;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Workspace lifecycle, structured Git and (unless disabled) repository guidance tools (no bash tool). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    tools(): ToolSet;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Disposes the manager&#39;s expired workspaces and, with \`isSettled\`, the</span></span>
<span class="line"><span style="color:#958A8B;">     * ones of settled runs, then runs the provider&#39;s collection (deployment</span></span>
<span class="line"><span style="color:#958A8B;">     * and \`isSettled\` passed on); returns how many went.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    collectGarbage(): Promise&lt;number&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Unsubscribes every attach, aborts the creates in flight (disposing what</span></span>
<span class="line"><span style="color:#958A8B;">     * they made) and forgets the held workspaces without disposing them: they</span></span>
<span class="line"><span style="color:#958A8B;">     * belong to live runs, which find them again after a restart (with</span></span>
<span class="line"><span style="color:#958A8B;">     * \`dispose: true\` it disposes them too). Waits for</span></span>
<span class="line"><span style="color:#958A8B;">     * the creates, for disposals started earlier and for the creates in</span></span>
<span class="line"><span style="color:#958A8B;">     * flight of runs released before (call after engine.drain()); afterwards</span></span>
<span class="line"><span style="color:#958A8B;">     * acquire, get and lookups reject and attach subscribes nothing. Resolves</span></span>
<span class="line"><span style="color:#958A8B;">     * after \`timeoutMs\` at the latest, reporting what is still being disposed</span></span>
<span class="line"><span style="color:#958A8B;">     * to \`onError\`.</span></span>
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
<span class="line"><span style="color:#958A8B;">    /** The remote&#39;s default branch, fetched as \`origin/&lt;name&gt;\` (the base to merge or rebase onto). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    defaultBranch: string | null;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The image of a container or pod workspace; null on local. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    reused: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Current root guidance; null without a repository or when collection is disabled. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    instructions: RepositoryInstructions | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> DisposeWorkspaceResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    disposed: true;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What \`git_fetch\`, \`git_pull\` and \`git_push\` answer: the git call&#39;s outcome, redacted. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitToolResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The repository URL git talked to (never a remote name of the repository config). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    remote: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdout: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderr: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    timedOut: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitFetchResult = GitToolResult &amp; {</span></span>
<span class="line"><span style="color:#E6DFDE;">    refspec: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitPullResult = GitToolResult &amp; {</span></span>
<span class="line"><span style="color:#E6DFDE;">    branch: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    rebase: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The step the result is of: the fetch when it failed, else the merge or rebase. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    step: </span><span style="color:#E7C58C;">&#39;fetch&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;merge&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;rebase&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitPushResult = GitToolResult &amp; {</span></span>
<span class="line"><span style="color:#E6DFDE;">    branch: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The commit pushed. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    commit: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    pushed: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    forced: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h3 id="repository-instructions" tabindex="-1">Repository instructions <a class="header-anchor" href="#repository-instructions" aria-label="Permalink to &quot;Repository instructions&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> readRepositoryInstructions(</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: IWorkspace,</span></span>
<span class="line"><span style="color:#E6DFDE;">    paths?: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[],</span></span>
<span class="line"><span style="color:#E6DFDE;">    options?: ReadRepositoryInstructionsOptions,</span></span>
<span class="line"><span style="color:#E6DFDE;">): Promise&lt;RepositoryInstructions&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> ReadRepositoryInstructionsOptions = { signal?: AbortSignal; clock?: IClock };</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> RepositoryInstructionSource = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    sha256: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    content: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    scopes: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    includedBy: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> RepositoryInstructionDiagnosticCode = </span><span style="color:#E7C58C;">&#39;missing-include&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;unreadable&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;invalid-utf8&#39;</span></span>
<span class="line"><span style="color:#E6DFDE;">    | </span><span style="color:#E7C58C;">&#39;outside-workspace&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;unsupported-file&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;cycle&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;limit&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> RepositoryInstructionDiagnostic = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    code: RepositoryInstructionDiagnosticCode;</span></span>
<span class="line"><span style="color:#E6DFDE;">    message: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> RepositoryInstructions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    commit: string | null;</span></span>
<span class="line"><span style="color:#E6DFDE;">    paths: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    sources: RepositoryInstructionSource[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    diagnostics: RepositoryInstructionDiagnostic[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    complete: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p><code>clock</code> defaults to <code>systemClock</code> and measures the request deadline; <code>signal</code> cancels collection. The function works through <code>IWorkspace.exec</code>, without host filesystem reads or repository program execution. The manager&#39;s <code>read_repository_instructions({ paths?, workspace? })</code> resolves the calling run&#39;s workspace and forwards its cancellation signal. Paths default to <code>[&#39;.&#39;]</code>, follow workspace path normalization (relative or <code>/workspace/...</code>), and existing directories include themselves; files and missing targets use their parent.</p><p><code>create_workspace</code> adds <code>instructions: RepositoryInstructions | null</code> to <code>WorkspaceToolResult</code>. Repository-backed creates, including reuse or adoption, collect root guidance afresh. Repo-less creates return <code>null</code>. With <code>createWorkspaceManager({ provider, repositoryInstructions: false })</code>, <code>create_workspace</code> returns <code>instructions: null</code> and the explicit tool is omitted; the default is <code>true</code>. <code>sandboxModule({ repositoryInstructions: false })</code> forwards this manager option. There is no corresponding environment variable. The separate <a href="/reference/coding#repository-instructions"><code>codingTools</code> option</a> controls text-read attachments independently.</p><p>Entrypoint discovery visits root and requested ancestors only, ordered by directory depth then JavaScript string order; explicit includes may reference permitted files elsewhere in the workspace. Each directory reads <code>AGENTS.md</code> before <code>CLAUDE.md</code>, each immediately followed by its included files in depth-first textual order. Only standalone <code>@relative/path</code> lines count, with surrounding whitespace allowed and none within the path. Ordinary links, inline <code>@</code> text and fenced code are ignored. Fences use at least three backticks or tildes; a closing fence uses the same character with at least the opening length. Includes resolve relative to their source, allowing <code>..</code> only inside the workspace and refusing absolute paths, home paths, URLs, NUL and escapes.</p><p>Sources are deduplicated by canonical workspace-relative path; <code>scopes</code> retains every applicable entrypoint directory (<code>.</code> for root) and <code>includedBy</code> every including parent. Included guides inherit their entrypoint&#39;s scope. <code>sha256</code> hashes exact original bytes, before credential redaction; <code>content</code> is strictly decoded UTF-8 and redacted before include parsing. Outward paths and diagnostics are redacted too. The collector preserves provenance rather than resolving contradictory prose. <code>commit</code> is <code>workspace.info.commit ?? null</code>, the recorded checkout commit, not necessarily current HEAD; hashes identify the bytes actually read. There is no transactionally frozen snapshot and no cache across calls.</p><table tabindex="0"><thead><tr><th>Exported bound</th><th>Value</th></tr></thead><tbody><tr><td><code>INSTRUCTION_FILES</code></td><td><code>[&#39;AGENTS.md&#39;, &#39;CLAUDE.md&#39;]</code></td></tr><tr><td><code>INSTRUCTION_SOURCE_MAX_BYTES</code></td><td>32 768 (32 KiB), each source whole or omitted</td></tr><tr><td><code>INSTRUCTION_TOTAL_MAX_BYTES</code></td><td>131 072 (128 KiB), total source bytes</td></tr><tr><td><code>INSTRUCTION_SOURCES_MAX</code></td><td>32 distinct sources</td></tr><tr><td><code>INSTRUCTION_INCLUDE_DEPTH_MAX</code></td><td>8 include edges from an entrypoint</td></tr><tr><td><code>INSTRUCTION_PATHS_MAX</code></td><td>32 requested paths</td></tr><tr><td><code>INSTRUCTION_DIRECTORIES_MAX</code></td><td>64 distinct ancestor directories, root included</td></tr><tr><td><code>INSTRUCTION_REFERENCES_MAX</code></td><td>512 attempted inspections and include references</td></tr><tr><td><code>INSTRUCTION_DIAGNOSTICS_MAX</code></td><td>64 entries, including a closing limit diagnostic</td></tr><tr><td><code>INSTRUCTION_DIAGNOSTICS_MAX_BYTES</code></td><td>8192 UTF-8 bytes of diagnostic paths and messages together</td></tr><tr><td><code>INSTRUCTION_PATH_MAX_BYTES</code></td><td>4096 UTF-8 bytes per path</td></tr><tr><td><code>INSTRUCTION_REQUEST_TIMEOUT_MS</code></td><td>30 000 (30 s) per request</td></tr><tr><td><code>INSTRUCTION_EXEC_TIMEOUT_MS</code></td><td>5000 (5 s) per exec</td></tr></tbody></table><p>Missing optional entrypoints are normal. Missing explicit includes, unreadable files, invalid UTF-8, refused paths, cycles and bound exhaustion add diagnostics; any diagnostic makes <code>complete: false</code>. Sources are never silently truncated. Invalid input shapes throw <code>ValidationError</code>; cancellation, workspace lookup failures, transport errors, exec timeouts, missing inspection capabilities and malformed or truncated protocol responses reject through the existing error path, never a successful empty result. The overall request deadline produces a <code>limit</code> diagnostic with the sources collected so far.</p><p>Fixed discovery scripts run in the physical workspace cwd and resolve utilities on <code>/usr/bin:/bin</code>, excluding repository executables. Each read is bounded to 32 KiB + 1 byte with framed base64 output, checked against the 65 536-byte transport cap, exit status, timeout, truncation flags, lengths and completion marker. Missing utilities produce an explicit failure; there is no interpreter or image-contract expansion. Every observed symlink component (including aliases within the workspace), special file and <code>.git</code> component is refused. Checks are best-effort against the observed filesystem; concurrent changes can race them. Strict race-free confinement is deferred to <a href="https://github.com/chamvi/chamvi/issues/92" target="_blank" rel="noreferrer">#92</a>.</p><p>Delivered context is ordinary tool output retained in model messages, steps and checkpoints across approval pauses and recovery. The next create, explicit context call or applicable file read collects current guidance, including changed files in a reused or recovered workspace, without replacing older messages. These tools are not effect tools. See <a href="/guide/workspaces#repository-instructions">Repository instructions</a> for the pre-edit workflow and authorization boundaries.</p><h3 id="git-credentials" tabindex="-1">Git credentials <a class="header-anchor" href="#git-credentials" aria-label="Permalink to &quot;Git credentials&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> staticGitCredentials(entries: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> StaticGitCredential[]): IGitCredentials;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> REDACTED: </span><span style="color:#E7C58C;">&#39;[redacted]&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CREDENTIAL_REFRESH_MS: </span><span style="color:#E7C58C;">600_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CREDENTIAL_RETRY_MS: </span><span style="color:#E7C58C;">60_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CREDENTIALS_FILE: </span><span style="color:#E7C58C;">&#39;.chamvi/credentials&#39;</span><span style="color:#E6DFDE;">; </span><span style="color:#958A8B;">// below $HOME, mode 0600</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> REDACT_MIN_LENGTH: </span><span style="color:#E7C58C;">4</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> REDACT_GRACE_MS: </span><span style="color:#E7C58C;">3_600_000</span><span style="color:#E6DFDE;">;   </span><span style="color:#958A8B;">// an expired token stays redacted this long</span></span></code></pre></div><p><code>staticGitCredentials</code> throws <code>InvalidAgentDefinitionError</code> for an entry without a host name (an optional port), a token or username with NUL, CR, LF or tab, or a <code>path</code> that is no owner or repository, naming the entry and never a token. A source&#39;s answer must be non-empty strings without those characters (<code>expiresAt</code> a <code>Date</code>), else the lookup is a <code>SandboxError</code>.</p><p>The structured Git tools run every remote call as <code>git -c credential.helper= -c core.hooksPath=/dev/null ...</code>, or with a credential as <code>sh -c &lt;script&gt; sh &lt;url&gt; &lt;origin&gt; &lt;path&gt; &lt;git args&gt;</code> with <code>&lt;username&gt;\\n&lt;password&gt;\\n</code> on stdin: the script hands the credential to git through a one-shot helper on fd 3 that answers only for that origin and path. A URL-specific key in the repository&#39;s or the global git config beats a generic <code>-c</code>, so the script cannot force settings on; it checks the config for the URL first and refuses (a <code>SandboxError</code> naming the keys, nothing sent) when it sets a proxy (<code>http.proxy</code>, <code>remote.&lt;name&gt;.proxy</code>), turns <code>http.sslVerify</code> off, names another CA (<code>http.sslCAInfo</code>, <code>http.sslCAPath</code>), overrides name resolution (<code>http.curloptResolve</code>) or rewrites URLs (<code>url.&lt;base&gt;.insteadOf</code>, <code>pushInsteadOf</code>). It also allows git only the https transport (<code>GIT_ALLOW_PROTOCOL=https</code>, which no config can override), so a transport the config names for the URL (<code>remote.&lt;url&gt;.vcs</code>) never starts and cannot read the credential git hands its helpers. The workspace helper (<code>$HOME/.chamvi/git-credential</code>, set as the global <code>credential.helper</code> with <code>credential.useHttpPath</code>) answers from the credentials file, the repository&#39;s line first, else the host&#39;s.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitAccess = </span><span style="color:#E7C58C;">&#39;read&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;write&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What a credential source is asked: one repository (or, with an empty \`path\`, its host) and an access. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitCredentialRequest = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The normalized repository URL (\`https://host/owner/name.git\`), or \`https://host/\` for the host itself. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Lower case, with the port when the URL names one. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    host: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Without leading or trailing \`/\` and without \`.git\`, e.g. \`owner/name\`; empty for the host itself. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    access: GitAccess;</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** HTTP basic credentials for git; \`expiresAt\` for a short-lived token (refreshed before it runs out). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitCredential = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    username: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    password: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt?: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * A source of git credentials. \`get\` answers credentials for the</span></span>
<span class="line"><span style="color:#958A8B;"> * repository, or \`undefined\` to try the next source (none: anonymous).</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IGitCredentials {</span></span>
<span class="line"><span style="color:#E6DFDE;">    get(input: GitCredentialRequest): Promise&lt;GitCredential | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** One token of \`staticGitCredentials()\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> StaticGitCredential = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The host, e.g. \`github.com\` or \`gitlab.example.com:8443\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    host: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** An owner, group or repository prefix (whole segments, case-insensitive), e.g. \`octo\` or \`octo/demo\`; default the whole host. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    path?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Default \`oauth2\` on a host whose name contains \`gitlab\`, else \`x-access-token\` (GitHub). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    username?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    token: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Replaces issued credentials with \`REDACTED\`. */</span></span>
<span class="line"><span style="color:#958A8B;">/** A span of a text, \`start\` inclusive and \`end\` exclusive (UTF-16 code units). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RedactedSpan = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    start: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    end: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Redactor = {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Redacts \`secret\` from now on; with \`expiresAt\` only until</span></span>
<span class="line"><span style="color:#958A8B;">     * \`REDACT_GRACE_MS\` after it (adding it again keeps the later expiry,</span></span>
<span class="line"><span style="color:#958A8B;">     * none wins).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    add(secret: string, expiresAt?: Date): void;</span></span>
<span class="line"><span style="color:#E6DFDE;">    redact(text: string): string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The spans of \`text\` that \`redact\` replaces, in order and without overlap. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    redactedSpans(text: string): RedactedSpan[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** The same bytes when they hold no secret. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    redactBytes(bytes: Uint8Array): Uint8Array;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The same error when its message holds no secret, else a SandboxError with the redacted message and no cause. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    redactError(error: unknown): unknown;</span></span>
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
<span class="line"><span style="color:#958A8B;">    /** The remote&#39;s default branch (its HEAD), fetched next to \`ref\`: the base of a merge or rebase. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    defaultBranch?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The image of a container or pod workspace. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
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
<span class="line"><span style="color:#958A8B;">    /** UTF-8 text of at most \`FILE_MAX_BYTES\`; SandboxError for a file that is not UTF-8. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readFile(path: string): Promise&lt;string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The raw bytes of a file of at most \`FILE_MAX_BYTES\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readBytes(path: string): Promise&lt;Uint8Array&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A string is written as UTF-8, bytes as they are; at most \`FILE_MAX_BYTES\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    writeFile(path: string, content: string | Uint8Array): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Idempotent. Every call after it rejects with SandboxError. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    dispose(): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Replaces the git credentials issued for the workspace with</span></span>
<span class="line"><span style="color:#958A8B;">     * \`[redacted]\`: set on the workspaces a manager with credentials hands</span></span>
<span class="line"><span style="color:#958A8B;">     * out, whose results and errors are already redacted. A tool that decodes</span></span>
<span class="line"><span style="color:#958A8B;">     * output itself (base64 from an exec) passes the decoded text through it.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    redact?(text: string): string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The unredacted text of a file (as \`readFile\` without the redaction):</span></span>
<span class="line"><span style="color:#958A8B;">     * set beside \`redact\` on the workspaces a manager with credentials hands</span></span>
<span class="line"><span style="color:#958A8B;">     * out, for tools that write the text back (an edit), so a file holding</span></span>
<span class="line"><span style="color:#958A8B;">     * an issued token never gets \`[redacted]\` written into it. Never for</span></span>
<span class="line"><span style="color:#958A8B;">     * text shown to the model.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readFileRaw?(path: string): Promise&lt;string&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The spans of \`text\` that \`redact\` replaces with \`[redacted]\`, in order</span></span>
<span class="line"><span style="color:#958A8B;">     * and without overlap: set beside \`redact\`, so a tool working on the raw</span></span>
<span class="line"><span style="color:#958A8B;">     * text (an edit of \`readFileRaw\`) can match what the model read and keep</span></span>
<span class="line"><span style="color:#958A8B;">     * every issued token byte for byte.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    redactedSpans?(text: string): Array&lt;{ start: number; end: number }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { CheckoutOptions } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../repo/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
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
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Hard cap of a workspace&#39;s lifetime (its \`expiresAt\`), from its creation,</span></span>
<span class="line"><span style="color:#958A8B;">     * never renewed. Nothing kills a workspace earlier while its run lives;</span></span>
<span class="line"><span style="color:#958A8B;">     * garbage collection removes it once expired or its run settled.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxLifetimeMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WorkspaceCreateOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A normalized repository URL (\`normalizeRepo\`); without it the workspace is only \`git init\`-ed. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ref?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Passed to \`prepareWorkspace\`: a shallow \`depth\`, the read \`credential\` of a private repository. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    checkout?: CheckoutOptions;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The image of a container or pod workspace; default the provider&#39;s. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    image?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: SandboxLimits;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The deployment the workspace belongs to; default \`DEFAULT_DEPLOYMENT\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    deployment?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WorkspaceFindOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Only workspaces of this deployment; default \`DEFAULT_DEPLOYMENT\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    deployment?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GarbageCollectOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Only workspaces of this deployment; default \`DEFAULT_DEPLOYMENT\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    deployment?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * True when the run settled or no longer exists: its workspaces go too,</span></span>
<span class="line"><span style="color:#958A8B;">     * expired or not. A rejection keeps them and counts as a failure.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    isSettled?(runId: string): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ISandboxProvider {</span></span>
<span class="line"><span style="color:#FF7B84;">    readonly</span><span style="color:#E6DFDE;"> name: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * A ready workspace (id \`randomUUID()\`), checked out when \`repo\` is given</span></span>
<span class="line"><span style="color:#958A8B;">     * (via \`prepareWorkspace\` with \`checkout\`, then \`info.commit\` and</span></span>
<span class="line"><span style="color:#958A8B;">     * \`info.defaultBranch\` from its result).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    create(options: WorkspaceCreateOptions): Promise&lt;IWorkspace&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Every live, unexpired workspace of the run in the deployment this</span></span>
<span class="line"><span style="color:#958A8B;">     * provider can reach (labels, folders), reconnected: the instance this</span></span>
<span class="line"><span style="color:#958A8B;">     * process holds, else a new one rebuilt from what lives with the</span></span>
<span class="line"><span style="color:#958A8B;">     * workspace. Never creates; a stopped Docker container is started again.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    find(runId: string, options?: WorkspaceFindOptions): Promise&lt;IWorkspace[]&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Deletes this provider&#39;s workspaces of the deployment past their expiry</span></span>
<span class="line"><span style="color:#958A8B;">     * and, with \`isSettled\`, those whose run settled; returns how many. One</span></span>
<span class="line"><span style="color:#958A8B;">     * that cannot be removed never keeps the others: the pass goes on and</span></span>
<span class="line"><span style="color:#958A8B;">     * rejects with one SandboxError at the end.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    collectGarbage(options?: GarbageCollectOptions): Promise&lt;number&gt;;</span></span>
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
<span class="line"><span style="color:#958A8B;">/** Cap of \`readFile\`, \`readBytes\` and \`writeFile\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> FILE_MAX_BYTES = </span><span style="color:#E7C58C;">16_777_216</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> EXEC_TIMEOUT_MS = </span><span style="color:#E7C58C;">300_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> EXEC_TIMEOUT_MAX_MS = </span><span style="color:#E7C58C;">1_800_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The HOME of a container or pod workspace: a disk-backed volume of its own</span></span>
<span class="line"><span style="color:#958A8B;"> * (Docker: an anonymous volume, Kubernetes: an emptyDir), kept across a</span></span>
<span class="line"><span style="color:#958A8B;"> * restart of a stopped container and removed with the workspace. Never</span></span>
<span class="line"><span style="color:#958A8B;"> * \`/tmp\`, which is memory-backed and charged to the memory limit: the</span></span>
<span class="line"><span style="color:#958A8B;"> * homes of cargo, rustup, Maven, Gradle and mise&#39;s global config and</span></span>
<span class="line"><span style="color:#958A8B;"> * shims live here.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> WORKSPACE_HOME = </span><span style="color:#E7C58C;">&#39;/home/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The whole environment of a container or pod workspace (plus the configured</span></span>
<span class="line"><span style="color:#958A8B;"> * \`env\`). \`safe.directory\` because \`/workspace\` is a root-owned volume.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> SANDBOX_ENV: Readonly&lt;Record&lt;string, string&gt;&gt; = Object.freeze({</span></span>
<span class="line"><span style="color:#E6DFDE;">    HOME: WORKSPACE_HOME,</span></span>
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
<span class="line"><span style="color:#E6DFDE;">    maxLifetimeMs: </span><span style="color:#E7C58C;">604_800_000</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">});</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The workspace image of Docker and Kubernetes: Debian with git, the build</span></span>
<span class="line"><span style="color:#958A8B;"> * tools and mise, which installs toolchains at runtime (\`images/sandbox-dev\`).</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> DEFAULT_SANDBOX_IMAGE = </span><span style="color:#E7C58C;">&#39;ghcr.io/chamvi/sandbox-dev:trixie&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Default size of the \`/tmp\` tmpfs of a container or pod workspace (toolchains go to the cache). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> TMP_SIZE = </span><span style="color:#E7C58C;">&#39;1Gi&#39;</span><span style="color:#E6DFDE;">;</span></span>
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
<span class="line"><span style="color:#958A8B;">/** The deployment a workspace belongs to (\`find\` and garbage collection see only their own). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> DEPLOYMENT_LABEL = </span><span style="color:#E7C58C;">&#39;chamvi.dev/deployment&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The deployment of a manager or provider call without one. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> DEFAULT_DEPLOYMENT = </span><span style="color:#E7C58C;">&#39;default&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`repoKey()\` of the workspace&#39;s repository (a label value; the URL itself may be longer). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> REPO_KEY_LABEL = </span><span style="color:#E7C58C;">&#39;chamvi.dev/repo-key&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Expiry in epoch milliseconds: a Docker label, a Kubernetes annotation. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> EXPIRES_AT_KEY = </span><span style="color:#E7C58C;">&#39;chamvi.dev/expires-at&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Creation in epoch milliseconds: a Docker label, a Kubernetes annotation. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> CREATED_AT_KEY = </span><span style="color:#E7C58C;">&#39;chamvi.dev/created-at&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The normalized repository URL: a Docker label, a Kubernetes annotation. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> REPO_URL_KEY = </span><span style="color:#E7C58C;">&#39;chamvi.dev/repo&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The requested ref: a Docker label, a Kubernetes annotation. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> REF_KEY = </span><span style="color:#E7C58C;">&#39;chamvi.dev/ref&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The image: a Docker label, a Kubernetes annotation. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> IMAGE_KEY = </span><span style="color:#E7C58C;">&#39;chamvi.dev/image&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * The command of a workspace container or pod (\`sh -c\` with the deadline,</span></span>
<span class="line"><span style="color:#958A8B;"> * epoch seconds, as \`$1\`): it sleeps until the workspace&#39;s \`expiresAt\`,</span></span>
<span class="line"><span style="color:#958A8B;"> * also when Docker starts the container again after a restart or a pod is</span></span>
<span class="line"><span style="color:#958A8B;"> * scheduled late, and exits at once past it. An absolute deadline, since a</span></span>
<span class="line"><span style="color:#958A8B;"> * fixed \`sleep &lt;lifetime&gt;\` would start over on every start.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> const</span><span style="color:#E6DFDE;"> SLEEP_UNTIL_SCRIPT = </span><span style="color:#E7C58C;">&#39;d=$(( $1 - $(date +%s) )); if [ &quot;$d&quot; -gt 0 ]; then exec sleep &quot;$d&quot;; fi&#39;</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><h3 id="rules" tabindex="-1">Rules <a class="header-anchor" href="#rules" aria-label="Permalink to &quot;Rules&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> normalizeRepo(input: string, options?: NormalizeRepoOptions): string;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertGitRef(ref: string): void;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> resolveWorkspacePath(path: string): string;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> resolveLimits(...layers: Array&lt;SandboxLimits | undefined&gt;): Required&lt;SandboxLimits&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> parseCpu(value: string): number;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> parseMemory(value: string): number;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertSandboxEnv(env: Record&lt;string, string&gt; | undefined): void;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> prepareWorkspace(</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: IWorkspace,</span></span>
<span class="line"><span style="color:#E6DFDE;">    input: { repo?: string; ref?: string; depth?: number; credential?: GitCredential; signal?: AbortSignal },</span></span>
<span class="line"><span style="color:#E6DFDE;">): Promise&lt;{ commit?: string; defaultBranch?: string }&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> readCheckout(workspace: IWorkspace, signal?: AbortSignal, clock?: IClock): Promise&lt;{ commit?: string; defaultBranch?: string } | undefined&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createOutputCollector(maxBytes: number): IOutputCollector;</span></span></code></pre></div><p>For provider authors, the workspace metadata <code>find</code> rebuilds the info from:</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertDeployment(value: unknown): string; </span><span style="color:#958A8B;">// DEFAULT_DEPLOYMENT for undefined, else a label value or ValidationError</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> repoKey(repo: string): string;            </span><span style="color:#958A8B;">// 32 hex of the URL&#39;s sha256, a label value</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> workspaceLabels(input: { id: string; runId: string; deployment: string; repo?: string }): Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> workspaceMetadata(info: WorkspaceInfo): Record&lt;string, string&gt;; </span><span style="color:#958A8B;">// created, expiry, repo, ref, image</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> readWorkspaceInfo(values: Readonly&lt;Record&lt;string, string | undefined&gt;&gt;, provider: string): WorkspaceInfo | undefined;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createSettledCheck(isSettled?: (runId: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;boolean&gt;): (runId: string) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> Promise&lt;boolean | SandboxError&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> lifetimeSeconds(info: Pick&lt;WorkspaceInfo, </span><span style="color:#E7C58C;">&#39;createdAt&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;expiresAt&#39;</span><span style="color:#E6DFDE;">&gt;): number; </span><span style="color:#958A8B;">// whole seconds, rounded up, at least 1: how long a container or pod sleeps</span></span></code></pre></div><p><code>normalizeRepo</code>, <code>assertGitRef</code> and <code>resolveWorkspacePath</code> throw <code>ValidationError</code> (model input); <code>resolveLimits</code>, <code>parseCpu</code>, <code>parseMemory</code> and <code>assertSandboxEnv</code> throw <code>InvalidAgentDefinitionError</code> (configuration); <code>prepareWorkspace</code> throws <code>SandboxError</code> with git&#39;s stderr when a checkout step fails, records the default branch as <code>git config chamvi.defaultBranch</code> and, as its last step, the checkout as <code>git config chamvi.checkout</code> (the commit, or <code>none</code> without a repo). <code>readCheckout</code> reads both back: <code>{ commit, defaultBranch? }</code>, <code>{}</code> for a repo-less workspace, <code>undefined</code> for a create that died before its checkout finished, which <code>find</code> must skip.</p><h3 id="images-privileges-and-the-cache" tabindex="-1">Images, privileges and the cache <a class="header-anchor" href="#images-privileges-and-the-cache" aria-label="Permalink to &quot;Images, privileges and the cache&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertImage(value: unknown): string;               </span><span style="color:#958A8B;">// an image reference, else ValidationError (never echoed)</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> probeImage(transport: IExecTransport, options: { image: string; clock?: IClock; signal?: AbortSignal }): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> cacheEnv(dir: string): Record&lt;string, string&gt;;     </span><span style="color:#958A8B;">// CACHE_ENV&#39;s variables under another folder (local)</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> isRootUser(user: string | number): boolean;        </span><span style="color:#958A8B;">// 0, &#39;0:&lt;gid&gt;&#39;, &#39;root&#39;, &#39;root:&lt;group&gt;&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> assertTmpSizeOption(value: unknown): void;         </span><span style="color:#958A8B;">// a positive memory quantity, else InvalidAgentDefinitionError</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CACHE_DIR: </span><span style="color:#E7C58C;">&#39;/cache&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> WORKSPACE_HOME: </span><span style="color:#E7C58C;">&#39;/home/sandbox&#39;</span><span style="color:#E6DFDE;">;                      </span><span style="color:#958A8B;">// HOME of a container or pod workspace, a disk-backed volume of its own</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CACHE_ENV: Readonly&lt;Record&lt;string, string&gt;&gt;;          </span><span style="color:#958A8B;">// XDG_CACHE_HOME, npm_config_cache, PIP_CACHE_DIR, GOMODCACHE, GOCACHE, COMPOSER_CACHE_DIR</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> ROOT_CAPABILITIES: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];                 </span><span style="color:#958A8B;">// CHOWN, DAC_OVERRIDE, FOWNER, FSETID, SETUID, SETGID, KILL</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> IMAGE_REQUIREMENTS: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];                </span><span style="color:#958A8B;">// sh, git, timeout (with -k)</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> IMAGE_PROBE_TIMEOUT_MS: </span><span style="color:#E7C58C;">30_000</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p><code>probeImage</code> runs one <code>sh -c</code> script straight on the transport (every workspace exec goes through <code>timeout</code>, which may be what is missing), right after the container or pod started and before the checkout: a <code>SandboxError</code> names what the image lacks (<code>git</code>, <code>timeout</code>, <code>a timeout that supports -k</code>, or <code>sh</code> when the script cannot start), or why the probe failed (no answer within <code>IMAGE_PROBE_TIMEOUT_MS</code> on the clock). Docker and Kubernetes add <code>ROOT_CAPABILITIES</code> back for a root user only and mount <code>/cache</code> with <code>CACHE_ENV</code> in every workspace.</p><h3 id="remote-workspaces" tabindex="-1">Remote workspaces <a class="header-anchor" href="#remote-workspaces" aria-label="Permalink to &quot;Remote workspaces&quot;">​</a></h3><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createRemoteWorkspace(input: RemoteWorkspaceInput): IWorkspace;</span></span>
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
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The connection closed before the stream ended (e.g. the daemon reset it</span></span>
<span class="line"><span style="color:#958A8B;">     * after the command exited with stdin still queued): the output may be</span></span>
<span class="line"><span style="color:#958A8B;">     * cut, so the workspace accepts the result only after the exit marker.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    closed?: boolean;</span></span>
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
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> SANDBOX_PROVIDER_NAMES: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> SandboxProviderName[]; </span><span style="color:#958A8B;">// [&#39;local&#39;, &#39;docker&#39;, &#39;kubernetes&#39;]</span></span></code></pre></div><p>Git credentials: the <code>credentials</code> option, then the tokens of <code>CHAMVI_GIT_TOKENS</code> (a JSON list of <code>StaticGitCredential</code>; an error names the variable and the entry, never a token), then every source other modules contribute to <code>AppToken.GIT_CREDENTIALS</code> (<code>githubModule()</code>&#39;s App), asked on each lookup. The provider is <code>CHAMVI_SANDBOX_PROVIDER</code>, else <code>options.provider</code>, else <code>local</code>, read from <code>options.env ?? process.env</code> when the factory is called; <code>CHAMVI_SANDBOX_NAMESPACE</code>, <code>CHAMVI_SANDBOX_IMAGE</code> and <code>CHAMVI_DEPLOYMENT</code> (the manager&#39;s <code>deployment</code>) win over the options too. <code>isSettled</code> defaults to the engine&#39;s <code>getRun</code>: a settled run&#39;s workspaces are collected, and a missing run&#39;s only with a named deployment (<code>CHAMVI_DEPLOYMENT</code> or <code>deployment</code>), since in <code>default</code> an unknown run may be another app&#39;s on the same host; give each app sharing a host its own name. In start and job mode <code>setup</code> imports the provider package (<code>@chamvi/sandbox-local</code>, <code>@chamvi/sandbox-docker</code> or <code>@chamvi/sandbox-k8s</code>, installed beside <code>@chamvi/sandbox</code> and resolved from there; they are no declared peers, since every provider depends on <code>@chamvi/sandbox</code> and release-please refuses the cycle; a missing one throws <code>InvalidAgentDefinitionError</code> naming it, and under a strict layout that hides undeclared packages (Yarn PnP, pnpm with <code>hoist=false</code>) pass a built provider as <code>options.provider</code>), and the lifecycle hooks attach the manager to the engine, provide it (<code>engineCreated</code>; in start mode also starting the garbage collection every <code>gcIntervalMs</code> on the engine&#39;s clock) and close it after the engine drained (the collection timer stopped first); <code>CHAMVI_SANDBOX_IMAGES</code> (a comma list of exact image references; an entry that is none is an <code>InvalidAgentDefinitionError</code> naming the variable) is the image allow-list and wins over <code>allowImage</code>; migrate mode does nothing. <code>@chamvi/app</code> is an optional peer: the main entry never imports it.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> SandboxProviderName = </span><span style="color:#E7C58C;">&#39;local&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;docker&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;kubernetes&#39;</span><span style="color:#E6DFDE;">;</span></span>
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
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="chamvi-sandbox-local" tabindex="-1">@chamvi/sandbox-local <a class="header-anchor" href="#chamvi-sandbox-local" aria-label="Permalink to &quot;@chamvi/sandbox-local&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createLocalSandbox(options?: LocalSandboxOptions): ISandboxProvider; </span><span style="color:#958A8B;">// name &#39;local&#39;</span></span></code></pre></div><p>No isolation: development and tests only. Workspaces are folders under <code>root</code> (default <code>&lt;os tmpdir&gt;/chamvi-workspaces</code>); of the limits only <code>maxLifetimeMs</code> applies. The cache variables point into <code>&lt;root&gt;/.cache</code> (<code>cache: false</code> sets none). <code>find</code> rebuilds a workspace from its <code>workspace.json</code>, so a restarted process reaches it; the record holds the create&#39;s <code>env</code> on disk, so the folder is <code>0700</code> and the record <code>0600</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
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
<span class="line"><span style="color:#958A8B;">    /** The only limit local enforces: the workspace lifetime (expiry, \`maxLifetimeMs\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: Pick&lt;SandboxLimits, </span><span style="color:#E7C58C;">&#39;maxLifetimeMs&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Point the package caches (\`CACHE_ENV\`&#39;s variables) into \`&lt;root&gt;/.cache\`,</span></span>
<span class="line"><span style="color:#958A8B;">     * shared by every workspace of the root. Default true.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cache?: boolean;</span></span>
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
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * \`workspace.json\` of a workspace folder (internal): what \`find\` rebuilds</span></span>
<span class="line"><span style="color:#958A8B;"> * the workspace from and the garbage collection reads. Times are ISO strings.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WorkspaceRecord = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    deployment: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    repo?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    ref?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The create&#39;s \`env\` (the provider&#39;s own is added again on every exec). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    createdAt: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A readable workspace record (internal). */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ParsedRecord = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    deployment: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    info: WorkspaceInfo;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="chamvi-sandbox-docker" tabindex="-1">@chamvi/sandbox-docker <a class="header-anchor" href="#chamvi-sandbox-docker" aria-label="Permalink to &quot;@chamvi/sandbox-docker&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createDockerSandbox(options?: DockerSandboxOptions): ISandboxProvider; </span><span style="color:#958A8B;">// name &#39;docker&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> DEFAULT_NETWORK: </span><span style="color:#E7C58C;">&#39;bridge&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CONTAINER_NAME_PREFIX: </span><span style="color:#E7C58C;">&#39;chamvi-ws-&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> DEFAULT_USER: </span><span style="color:#E7C58C;">&#39;0:0&#39;</span><span style="color:#E6DFDE;">;</span></span></code></pre></div><p>One container per workspace (<code>sh -c</code> sleeping until <code>expiresAt</code>, also after a restart, under docker-init, <code>Init: true</code>, which reaps orphans for any image, with the image&#39;s entrypoint replaced: it stops itself at <code>expiresAt</code>), removed with its volume on dispose or by the garbage collection. Root with a writable root and <code>ROOT_CAPABILITIES</code> by default; <code>{ user: &#39;1000:1000&#39;, readOnlyRoot: true }</code> is the hardened mode. <code>/cache</code> is an anonymous volume per workspace, or with <code>cache: { volume }</code> that named volume, shared by every workspace using it (a trust boundary). <code>pull</code> applies to every image, also one a run asked for. <code>find</code> lists a run&#39;s containers by label and starts a stopped one again. Creating the provider contacts nothing.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { SandboxLimits, WorkspaceInfo } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
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
<span class="line"><span style="color:#958A8B;">     * before every create (a mutable tag then follows its rebuilds), \`&#39;never&#39;\`</span></span>
<span class="line"><span style="color:#958A8B;">     * never. It covers every image: the provider&#39;s \`image\`, the manager&#39;s and</span></span>
<span class="line"><span style="color:#958A8B;">     * one a run asked for (\`create_workspace({ image })\`).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    pull?: </span><span style="color:#E7C58C;">&#39;missing&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;always&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;never&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Added to every workspace&#39;s environment, after \`SANDBOX_ENV\` and \`CACHE_ENV\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    env?: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits?: SandboxLimits;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The container user and the user of every command; default \`DEFAULT_USER\`</span></span>
<span class="line"><span style="color:#958A8B;">     * (\`&#39;0:0&#39;\`, root with the \`ROOT_CAPABILITIES\`). \`&#39;1000:1000&#39;\` with</span></span>
<span class="line"><span style="color:#958A8B;">     * \`readOnlyRoot: true\` is the hardened mode (no capability at all).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    user?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A read-only root filesystem (only \`/workspace\`, \`/cache\` and \`/tmp\` writable). Default false. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readOnlyRoot?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The \`/cache\` mount. Default: an anonymous volume per workspace,</span></span>
<span class="line"><span style="color:#958A8B;">     * removed with it. \`{ volume }\` mounts that named volume in every</span></span>
<span class="line"><span style="color:#958A8B;">     * workspace instead: a trust boundary shared by every run and agent on</span></span>
<span class="line"><span style="color:#958A8B;">     * the host (a package one run fetched can be used by another). Never</span></span>
<span class="line"><span style="color:#958A8B;">     * point a non-root \`user\` at a volume a root workspace wrote to.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cache?: { volume: string };</span></span>
<span class="line"><span style="color:#958A8B;">    /** Size of the \`/tmp\` tmpfs; default \`TMP_SIZE\` (\`&#39;1Gi&#39;\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    tmpSize?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    clock?: IClock;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ContainerOptionsInput = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    deployment: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Run, image, repo, ref and times: labels a provider&#39;s \`find\` rebuilds the info from. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    info: WorkspaceInfo &amp; { image: string };</span></span>
<span class="line"><span style="color:#E6DFDE;">    network: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    user: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    readOnlyRoot: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The shared cache volume (\`cache.volume\`); undefined mounts an anonymous one per workspace. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cacheVolume?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    tmpSize: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    env: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits: Required&lt;SandboxLimits&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="chamvi-sandbox-k8s" tabindex="-1">@chamvi/sandbox-k8s <a class="header-anchor" href="#chamvi-sandbox-k8s" aria-label="Permalink to &quot;@chamvi/sandbox-k8s&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createKubernetesSandbox(options: KubernetesSandboxOptions): ISandboxProvider; </span><span style="color:#958A8B;">// name &#39;k8s&#39;</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> createPodClient(input: CreatePodClientInput): IPodClient;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> CONTAINER_NAME: </span><span style="color:#E7C58C;">&#39;sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> POD_NAME_PREFIX: </span><span style="color:#E7C58C;">&#39;chamvi-ws-&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> START_TIMEOUT_MS: </span><span style="color:#E7C58C;">120_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> POLL_MS: </span><span style="color:#E7C58C;">1_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> FATAL_WAITING_REASONS: </span><span style="color:#FF7B84;">readonly</span><span style="color:#E6DFDE;"> string[];</span></span></code></pre></div><p>One pod per workspace, sleeping for its lifetime with that <code>activeDeadlineSeconds</code> (the image&#39;s entrypoint replaced), so it ends itself at <code>expiresAt</code>; <code>imagePullPolicy</code> applies to every image; <code>find</code> lists a run&#39;s running pods by label. Root with a writable root and <code>ROOT_CAPABILITIES</code> by default (Pod Security <code>baseline</code>); <code>{ user: { uid: 1000, gid: 1000 }, readOnlyRoot: true }</code> is the hardened mode (<code>restricted</code>). <code>/cache</code> is the claim of <code>cache.claimName</code> or an emptyDir. The Role needs <code>pods</code> <code>create</code>, <code>get</code>, <code>list</code>, <code>delete</code> and <code>pods/exec</code> <code>get</code> and <code>create</code> in the sandbox namespace. See <a href="/deployment/kubernetes#sandboxes-in-the-cluster">Kubernetes &amp; Flux</a>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { KubeConfig } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@kubernetes/client-node&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IClock } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/core&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { SandboxLimits, WorkspaceInfo } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IPodClient } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../client/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ImagePullPolicy = </span><span style="color:#E7C58C;">&#39;Always&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;IfNotPresent&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> PodUser = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    uid: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    gid: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
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
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Pull policy of every workspace image (the provider&#39;s, the manager&#39;s</span></span>
<span class="line"><span style="color:#958A8B;">     * and one a run asked for through \`create_workspace({ image })\`):</span></span>
<span class="line"><span style="color:#958A8B;">     * default \`&#39;IfNotPresent&#39;\`, \`&#39;Always&#39;\` for a mutable tag.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    imagePullPolicy?: ImagePullPolicy;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * uid and gid of the pod; default \`{ uid: 0, gid: 0 }\` (root with the</span></span>
<span class="line"><span style="color:#958A8B;">     * \`ROOT_CAPABILITIES\`, which needs a namespace whose Pod Security admits</span></span>
<span class="line"><span style="color:#958A8B;">     * root pods, i.e. \`baseline\`). \`{ uid: 1000, gid: 1000 }\` with</span></span>
<span class="line"><span style="color:#958A8B;">     * \`readOnlyRoot: true\` is the hardened mode, which \`restricted\` admits.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    user?: PodUser;</span></span>
<span class="line"><span style="color:#958A8B;">    /** A read-only root filesystem (only \`/workspace\`, \`/cache\` and \`/tmp\` writable). Default false. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readOnlyRoot?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * A ReadWriteMany claim every workspace mounts at \`/cache\`, shared by every</span></span>
<span class="line"><span style="color:#958A8B;">     * run and agent of the namespace (a package one run fetched can be used by</span></span>
<span class="line"><span style="color:#958A8B;">     * another). Without it each pod gets an emptyDir \`/cache\` of its own.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cache?: { claimName: string };</span></span>
<span class="line"><span style="color:#958A8B;">    /** Size of the in-memory \`/tmp\`; default \`TMP_SIZE\` (\`&#39;1Gi&#39;\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    tmpSize?: string;</span></span>
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
<span class="line"><span style="color:#E6DFDE;">    deployment: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    namespace: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Run, image, repo, ref and times: labels and annotations a provider&#39;s \`find\` rebuilds the info from. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    info: WorkspaceInfo &amp; { image: string };</span></span>
<span class="line"><span style="color:#E6DFDE;">    env: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limits: Required&lt;SandboxLimits&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The \`podLabels\`; the managed labels win. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    labels: Record&lt;string, string&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    imagePullPolicy: ImagePullPolicy;</span></span>
<span class="line"><span style="color:#E6DFDE;">    user: PodUser;</span></span>
<span class="line"><span style="color:#E6DFDE;">    readOnlyRoot: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The shared cache claim; undefined mounts an emptyDir. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cacheClaim?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    tmpSize: string;</span></span>
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
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h3 id="bash-first-migration" tabindex="-1">Bash-first migration <a class="header-anchor" href="#bash-first-migration" aria-label="Permalink to &quot;Bash-first migration&quot;">​</a></h3><p>Remove <code>credentialMode</code>, its <code>CredentialMode</code> type and <code>CHAMVI_GIT_CREDENTIAL_MODE</code>. Workspace-installed credentials are the only mode. The structured Git tools, their result types and <code>PushPolicy</code> remain available. Push checks govern <code>git_push</code> only; sandbox code with another execution path can bypass them.</p><h3 id="structured-git-tools-and-policy-scope" tabindex="-1">Structured Git tools and policy scope <a class="header-anchor" href="#structured-git-tools-and-policy-scope" aria-label="Permalink to &quot;Structured Git tools and policy scope&quot;">​</a></h3><p><code>manager.tools()</code> includes <code>git_fetch</code>, <code>git_pull</code> and <code>git_push</code> without granting a bash tool. They retain structured results, per-target credential lookup, force-with-lease, branch checks and the optional durable approval flow through <code>push: { mode: &#39;approve&#39;, channel?, allowBranch?, allowForce? }</code>. These checks apply only to <code>git_push</code>: bash with write credentials can bypass them. Disabling bash narrows the offered capabilities, but writable Git configuration, hooks and other indirect execution still require a threat model; the tools are not a credential-secrecy boundary. Enforce hard restrictions through token scope and forge rules.</p>`,67)])])}const D=n(l,[["render",p]]);export{E as __pageData,D as default};
