import{_ as e,o as n,c as a,a2 as t}from"./chunks/framework.Di-jvWLj.js";const u=JSON.parse('{"title":"Store Contract","description":"","frontmatter":{},"headers":[],"relativePath":"stores/index.md","filePath":"stores/index.md","lastUpdated":1793209247000}'),o={name:"stores/index.md"};function l(p,s,r,c,i,d){return n(),a("div",null,[...s[0]||(s[0]=[t(`<h1 id="store-contract" tabindex="-1">Store Contract <a class="header-anchor" href="#store-contract" aria-label="Permalink to &quot;Store Contract&quot;">​</a></h1><p>Everything the engine persists goes through one interface, <code>IStore</code>. It is a set of small interfaces, so a store can be built and tested part by part.</p><table tabindex="0"><thead><tr><th>Interface</th><th>Holds</th><th>Key operations</th></tr></thead><tbody><tr><td><code>IRunStore</code></td><td>Runs</td><td><code>createRun</code> (insert-if-absent), <code>getRun</code>, <code>updateRun</code> with <code>expectStatus</code>/<code>expectOwner</code> guards, <code>listRuns</code>, <code>claimRun</code>/<code>renewClaim</code> leases</td></tr><tr><td><code>IStepStore</code></td><td>Append-only steps per run</td><td><code>appendStep</code>, <code>listSteps</code></td></tr><tr><td><code>ICheckpointStore</code></td><td>The latest checkpoint per run</td><td><code>saveCheckpoint</code>, <code>latestCheckpoint</code></td></tr><tr><td><code>IIdempotencyStore</code></td><td>Intake keys</td><td><code>claimKey(scope, key, runId, ttlMs)</code>: the first caller wins</td></tr><tr><td><code>ILockStore</code></td><td>Keyed leases</td><td><code>acquire(key, owner, ttlMs)</code>, <code>release(key, owner)</code></td></tr><tr><td><code>IEffectStore</code></td><td>Recorded effect results</td><td><code>getEffect</code>, <code>putEffect</code></td></tr><tr><td><code>IStateStore</code></td><td>Per-agent state</td><td><code>kvGet</code>/<code>kvSet</code> (<code>undefined</code> removes the key), <code>kvList</code> (key code-point order, <code>limit</code>/<code>offset</code>), <code>docList</code>/<code>docUpsert</code>/<code>docDelete</code></td></tr><tr><td><code>IArtifactStore</code></td><td>Files of a run (attachments, files tools stored)</td><td><code>putArtifact(artifact, data)</code> (insert-if-absent), <code>getArtifact</code> (metadata), <code>readArtifact</code> (bytes), <code>listArtifacts(runId)</code></td></tr><tr><td><code>IAgentRevisionStore</code></td><td>One revision marker per <a href="/guide/agent-folders">folder agent</a>: <code>{ agent, hash, changedAt }</code>, no code</td><td><code>getAgentRevision</code>, <code>setAgentRevision</code> (upsert), <code>deleteAgentRevision</code> (a missing one is a no-op), <code>listAgentRevisions</code> (agent code-point order)</td></tr></tbody></table><p><code>IStore</code> extends all nine. A store written before agent folders existed needs the four <code>IAgentRevisionStore</code> methods (a breaking change of the 0.x line).</p><h2 id="rules-every-store-keeps" tabindex="-1">Rules every store keeps <a class="header-anchor" href="#rules-every-store-keeps" aria-label="Permalink to &quot;Rules every store keeps&quot;">​</a></h2><ol><li><strong>One expiry rule.</strong> A claim, key or lock created at time <code>T</code> with <code>ttlMs</code> is expired at exactly <code>T + ttlMs</code> and can be taken over at that instant.</li><li><strong>Time comes from the clock.</strong> Expiry decisions use an injected <code>IClock</code>, never the database&#39;s clock, so tests can drive time and replicas agree on one rule.</li><li><strong>No aliasing.</strong> Values are copied in and out. Mutating an object after passing it to the store, or one the store returned, never changes what the store holds.</li><li><strong>Atomic means atomic across callers.</strong> <code>createRun</code>, <code>claimKey</code>, <code>claimRun</code>, <code>renewClaim</code>, <code>acquire</code> and <code>putArtifact</code> must hold under concurrency, also across processes.</li><li><strong>Ordering.</strong> <code>listRuns</code> orders by <code>createdAt</code> ascending, ties broken by <code>id</code> ascending, or both descending with <code>order: &#39;desc&#39;</code> (newest first); <code>total</code> ignores <code>limit</code> and <code>offset</code>. <code>listArtifacts</code> orders the same way. <code>listAgentRevisions</code> orders by agent name in code-point order.</li><li><strong>Guards throw.</strong> <code>updateRun</code> throws <code>InvalidRunStateError</code> when <code>expectStatus</code> does not match, or when <code>expectOwner</code> is given and the claim is absent or held by another owner (expiry is not checked there: a lease is lost once taken over). It throws <code>RunNotFoundError</code> for an unknown run.</li><li><strong>Checkpoints.</strong> <code>saveCheckpoint</code> keeps the highest <code>stepIndex</code>; an equal index replaces.</li><li><strong>State filters.</strong> <code>docList</code> <code>where</code> matches top-level fields by equality.</li><li><strong>Artifacts.</strong> <code>putArtifact</code> resolves <code>false</code> and keeps the stored artifact when the id exists. Bytes are copied in and out like every other value, and <code>readArtifact</code> returns a plain <code>Uint8Array</code> (no <code>Buffer</code> or other subclass). <code>getArtifact</code> and <code>listArtifacts</code> return metadata only.</li></ol><h2 id="the-interfaces" tabindex="-1">The interfaces <a class="header-anchor" href="#the-interfaces" aria-label="Permalink to &quot;The interfaces&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { AgentRevision } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../agent/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Artifact } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../artifact/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { </span></span>
<span class="line"><span style="color:#E6DFDE;">    Checkpoint, </span></span>
<span class="line"><span style="color:#E6DFDE;">    Run, </span></span>
<span class="line"><span style="color:#E6DFDE;">    RunStatusLiteral, </span></span>
<span class="line"><span style="color:#E6DFDE;">    Step, </span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../run/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * Expiry rule shared by every TTL (run claims, idempotency keys, locks):</span></span>
<span class="line"><span style="color:#958A8B;"> * a lease/key created at time T with ttlMs expires AT T + ttlMs, i.e. at exactly</span></span>
<span class="line"><span style="color:#958A8B;"> * \`expiresAt\` it already counts as expired and can be taken over.</span></span>
<span class="line"><span style="color:#958A8B;"> *</span></span>
<span class="line"><span style="color:#958A8B;"> * Implementations must return copies: mutating a value passed in after the call,</span></span>
<span class="line"><span style="color:#958A8B;"> * or a value returned from the store, must never change what the store holds.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IRunStore {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Atomic insert-if-absent: resolves false and keeps the stored run when a run</span></span>
<span class="line"><span style="color:#958A8B;">     * with that id exists (two dispatches may create the run an idempotency key names).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    createRun(run: Run): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    getRun(id: string): Promise&lt;Run | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Throws InvalidRunStateError when \`expectStatus\` does not match the current</span></span>
<span class="line"><span style="color:#958A8B;">     * status, or when \`expectOwner\` is given and the run&#39;s claim is absent or held</span></span>
<span class="line"><span style="color:#958A8B;">     * by another owner (expiry is not checked: a lease is lost once taken over).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    updateRun(id: string, patch: Partial&lt;Run&gt;, opts?: { expectStatus?: RunStatusLiteral[]; expectOwner?: string }): Promise&lt;Run&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Ordered by createdAt, ties broken by id, both ascending (\`order\` \`asc\`,</span></span>
<span class="line"><span style="color:#958A8B;">     * the default) or both descending (\`desc\`). \`total\` ignores limit/offset.</span></span>
<span class="line"><span style="color:#958A8B;">     * Without \`limit\`, every matching run (from \`offset\`) is returned: there is</span></span>
<span class="line"><span style="color:#958A8B;">     * no default page size.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    listRuns(q: {</span></span>
<span class="line"><span style="color:#E6DFDE;">        agent?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        status?: RunStatusLiteral[];</span></span>
<span class="line"><span style="color:#E6DFDE;">        concurrencyKey?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">        limit?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">        offset?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">        order?: </span><span style="color:#E7C58C;">&#39;asc&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;desc&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    }): Promise&lt;{ data: Run[]; total: number }&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Atomic: only succeeds when unleased or the lease expired. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    claimRun(id: string, owner: string, ttlMs: number): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Extends the lease; only succeeds for the current, unexpired owner. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    renewClaim(id: string, owner: string, ttlMs: number): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IStepStore {</span></span>
<span class="line"><span style="color:#E6DFDE;">    appendStep(step: Step): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    listSteps(runId: string): Promise&lt;Step[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ICheckpointStore {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Keeps the highest stepIndex; an equal stepIndex replaces (approval responses are appended that way). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    saveCheckpoint(cp: Checkpoint): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    latestCheckpoint(runId: string): Promise&lt;Checkpoint | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IIdempotencyStore {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Atomic: the first caller per (scope, key) creates; others get the winner&#39;s runId. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    claimKey(scope: string, key: string, runId: string, ttlMs: number): Promise&lt;{ created: boolean; runId: string }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ILockStore {</span></span>
<span class="line"><span style="color:#E6DFDE;">    acquire(key: string, owner: string, ttlMs: number): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    release(key: string, owner: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IEffectStore {</span></span>
<span class="line"><span style="color:#E6DFDE;">    getEffect(key: string): Promise&lt;{ result: unknown } | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    putEffect(key: string, result: unknown): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IStateStore {</span></span>
<span class="line"><span style="color:#E6DFDE;">    kvGet(agent: string, key: string): Promise&lt;unknown&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`undefined\` removes the key. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    kvSet(agent: string, key: string, value: unknown): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * One agent&#39;s entries ordered by key in code-point order (\`COLLATE &quot;C&quot;\`),</span></span>
<span class="line"><span style="color:#958A8B;">     * values copied out; every entry (from \`offset\`) without \`limit\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    kvList(agent: string, q?: { limit?: number; offset?: number }): Promise&lt;Array&lt;{ key: string; value: unknown }&gt;&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`where\` matches by top-level equality. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    docList(</span></span>
<span class="line"><span style="color:#E6DFDE;">        agent: string,</span></span>
<span class="line"><span style="color:#E6DFDE;">        coll: string,</span></span>
<span class="line"><span style="color:#E6DFDE;">        q?: { where?: Record&lt;string, unknown&gt;; limit?: number },</span></span>
<span class="line"><span style="color:#E6DFDE;">    ): Promise&lt;Array&lt;{ id: string; doc: unknown }&gt;&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    docUpsert(agent: string, coll: string, id: string, doc: unknown): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    docDelete(agent: string, coll: string, id: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Files of runs (attachments and tool outputs): metadata and bytes, both copied in and out. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IArtifactStore {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Atomic insert-if-absent: resolves false and keeps the stored artifact</span></span>
<span class="line"><span style="color:#958A8B;">     * (metadata and bytes) when an artifact with that id exists.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    putArtifact(artifact: Artifact, data: Uint8Array): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Metadata only. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    getArtifact(id: string): Promise&lt;Artifact | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The bytes, as a plain Uint8Array (no Buffer or other subclass). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    readArtifact(id: string): Promise&lt;Uint8Array | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Metadata of a run&#39;s artifacts, ordered by createdAt ascending, ties broken by id ascending. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    listArtifacts(runId: string): Promise&lt;Artifact[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** One revision marker per folder agent, keyed by agent name, copied in and out. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IAgentRevisionStore {</span></span>
<span class="line"><span style="color:#E6DFDE;">    getAgentRevision(agent: string): Promise&lt;AgentRevision | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Upsert: replaces the hash and \`changedAt\` of an existing marker. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    setAgentRevision(revision: AgentRevision): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Deleting a missing marker is a no-op. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    deleteAgentRevision(agent: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Every marker, ordered by agent in code-point order (\`COLLATE &quot;C&quot;\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    listAgentRevisions(): Promise&lt;AgentRevision[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IStore </span><span style="color:#FF7B84;">extends</span><span style="color:#E6DFDE;"> IRunStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IStepStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ICheckpointStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IIdempotencyStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ILockStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IEffectStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IStateStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IArtifactStore,</span></span>
<span class="line"><span style="color:#E6DFDE;">    IAgentRevisionStore {}</span></span></code></pre></div><h2 id="stores" tabindex="-1">Stores <a class="header-anchor" href="#stores" aria-label="Permalink to &quot;Stores&quot;">​</a></h2><table tabindex="0"><thead><tr><th>Store</th><th>Package</th><th>Status</th></tr></thead><tbody><tr><td><a href="/stores/memory"><code>MemoryStore</code></a></td><td><code>@chamvi/core</code></td><td>Shipped. Development and tests</td></tr><tr><td><a href="/stores/typeorm">TypeORM</a></td><td><code>@chamvi/store-typeorm</code></td><td>Shipped. PostgreSQL, production</td></tr></tbody></table><p>Redis is never required. Any store that passes the <a href="/stores/writing-a-store">contract suite</a> from <code>@chamvi/test-kit</code> works with the engine.</p>`,11)])])}const g=e(o,[["render",l]]);export{u as __pageData,g as default};
