import{_ as e,o as n,c as a,a2 as o}from"./chunks/framework.Di-jvWLj.js";const u=JSON.parse('{"title":"Stores and repositories","description":"","frontmatter":{},"headers":[],"relativePath":"repositories/index.md","filePath":"repositories/index.md","lastUpdated":1793384109000}'),t={name:"repositories/index.md"};function l(r,s,p,c,i,d){return n(),a("div",null,[...s[0]||(s[0]=[o(`<h1 id="stores-and-repositories" tabindex="-1">Stores and repositories <a class="header-anchor" href="#stores-and-repositories" aria-label="Permalink to &quot;Stores and repositories&quot;">​</a></h1><p>The engine receives an <code>IStore</code> object with one implementation per persistence capability. Each role has its own small interface and can be built and tested independently.</p><table tabindex="0"><thead><tr><th>Interface</th><th>Holds</th><th>Key operations</th></tr></thead><tbody><tr><td><code>IRunRepository</code></td><td>Runs</td><td><code>insert</code> (insert-if-absent), <code>findOne</code>, <code>update</code> with <code>expectStatus</code>/<code>expectOwner</code> guards, <code>find</code>, <code>claim</code>/<code>renewClaim</code> leases</td></tr><tr><td><code>IStepRepository</code></td><td>Append-only steps per run</td><td><code>insert</code>, <code>find</code></td></tr><tr><td><code>ICheckpointRepository</code></td><td>The latest checkpoint per run</td><td><code>save</code>, <code>findOne</code></td></tr><tr><td><code>IIdempotencyRepository</code></td><td>Intake keys</td><td><code>claim(scope, key, runId, ttlMs)</code>: the first caller wins</td></tr><tr><td><code>ILockRepository</code></td><td>Keyed leases</td><td><code>acquire(key, owner, ttlMs)</code>, <code>release(key, owner)</code></td></tr><tr><td><code>IEffectRepository</code></td><td>Recorded effect results</td><td><code>findOne</code>, <code>save</code></td></tr><tr><td><code>IStateRepository</code></td><td>Per-agent state</td><td><code>findOne</code>/<code>set</code> (<code>undefined</code> removes the key), <code>find</code> (key code-point order, <code>limit</code>/<code>offset</code>), <code>findDocuments</code>/<code>upsertDocument</code>/<code>deleteDocument</code></td></tr><tr><td><code>IArtifactRepository</code></td><td>Files of a run (attachments, files tools stored)</td><td><code>insert(artifact, data)</code> (insert-if-absent), <code>findOne</code> (metadata), <code>read</code> (bytes), <code>find(runId)</code></td></tr><tr><td><code>IAgentRevisionRepository</code></td><td>One revision marker per <a href="/guide/agent-folders">folder agent</a>: <code>{ agent, hash, changedAt }</code>, no code</td><td><code>findOne</code>, <code>save</code> (upsert), <code>delete</code> (a missing one is a no-op), <code>find</code> (agent code-point order)</td></tr><tr><td><code>IConversationRepository</code> (optional)</td><td>Conversation generations, turn ownership, recall, journal and explicit notes</td><td><code>findOne</code>, <code>findItems</code>, <code>findNotes</code>, <code>findOneNote</code>; <code>resolve</code>, <code>beginTurn</code>, <code>endTurn</code>, <code>prepareEmit</code>, <code>confirmEmit</code>, <code>applyNote</code>, <code>reset</code>, <code>delete</code>, <code>prune</code></td></tr></tbody></table><p><code>IStore</code> has nine required fields: <code>runs</code>, <code>steps</code>, <code>checkpoints</code>, <code>idempotency</code>, <code>locks</code>, <code>effects</code>, <code>state</code>, <code>artifacts</code> and <code>agentRevisions</code>. Its optional <code>conversations</code> field implements <code>IConversationRepository</code>. Pass the aggregate as <code>new Engine({ store, agents })</code>; use <code>store.runs.findOne(id)</code> or <code>store.state.findOne(agent, key)</code> for direct access. <code>IStore</code> is a plain aggregate, not a facade with forwarding methods. Conversation storage alone does not enable memory: configure <code>conversations: { authorize, limits? }</code> on the engine and opt agents in.</p><h2 id="updating-existing-callers" tabindex="-1">Updating existing callers <a class="header-anchor" href="#updating-existing-callers" aria-label="Permalink to &quot;Updating existing callers&quot;">​</a></h2><p>This changes the storage API. <code>IStore</code> now aggregates individual repository interfaces rather than forwarding all operations through one facade. The <code>MemoryStore</code> and <code>TypeormStore</code> classes are removed; custom adapters assemble their capabilities into an <code>IStore</code> object.</p><table tabindex="0"><thead><tr><th>Previous API</th><th>Store aggregate API</th></tr></thead><tbody><tr><td><code>new MemoryStore(options)</code></td><td><code>createMemoryStore(options)</code></td></tr><tr><td><code>new TypeormStore(options)</code></td><td><code>createDatabaseStore(options)</code></td></tr><tr><td><code>engine.store.getRun(id)</code></td><td><code>engine.store.runs.findOne(id)</code></td></tr><tr><td><code>conversations: { store, authorize }</code></td><td><code>store.conversations</code> holds storage; <code>conversations: { authorize }</code> holds policy</td></tr><tr><td><code>container.resolve(AppToken.CONVERSATIONS)</code></td><td><code>container.resolve(AppToken.STORE).conversations</code></td></tr></tbody></table><p>Keep passing the aggregate through <code>new Engine({ store, agents })</code>, <code>storeModule({ store })</code> and <code>AppToken.STORE</code>. Factory option types are <code>MemoryStoreOptions</code> and <code>DatabaseStoreOptions</code>; <code>createDatabaseStore()</code> returns <code>DatabaseStore</code>.</p><p>The package is now <code>@chamvi/store-db</code> (previously <code>@chamvi/store-typeorm</code>). Replace package imports and dependencies; database tables and migration history keep their names. The class split itself changes no database schema. Existing TypeORM roles must keep sharing the same DataSource so their relationships remain valid.</p><h2 id="query-methods" tabindex="-1">Query methods <a class="header-anchor" href="#query-methods" aria-label="Permalink to &quot;Query methods&quot;">​</a></h2><p><code>findOne(...)</code> returns one record or <code>undefined</code>. <code>find(...)</code> returns the repository&#39;s existing collection shape: run queries return <code>{ data, total }</code>, while steps, artifacts, state and agent revisions return arrays. Conversation item/note queries return <code>{ data, total }</code> through <code>findItems</code> and <code>findNotes</code>.</p><p>The matching <code>OrFail</code> method returns the same result when it exists. <code>findOneOrFail(...)</code> throws for <code>undefined</code>; stored state values such as <code>null</code>, <code>false</code>, <code>0</code> and <code>&#39;&#39;</code> are valid results. <code>findOrFail(...)</code> throws when the selected array or page is empty, including a run query with <code>limit: 0</code> or an offset beyond the last result even when <code>total</code> is nonzero. Query validation is unchanged: conversation queries require <code>limit &gt;= 1</code>, so their <code>limit: 0</code> is a validation error. Qualified queries follow the same rule: <code>findDocumentsOrFail</code>, <code>findItemsOrFail</code>, <code>findNotesOrFail</code> and <code>findOneNoteOrFail</code>.</p><p>A missing single run or artifact uses <code>RunNotFoundError</code> or <code>ArtifactNotFoundError</code>; other missing repository results use <code>RepositoryNotFoundError</code>. Backend failures and validation errors pass through unchanged. Leases and mutations retain their domain operations, such as <code>claim</code>, <code>renewClaim</code> and <code>beginTurn</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> run = </span><span style="color:#FF7B84;">await</span><span style="color:#E6DFDE;"> store.runs.findOneOrFail(runId);</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> { data, total } = </span><span style="color:#FF7B84;">await</span><span style="color:#E6DFDE;"> store.runs.find({ agent: run.agent, limit: </span><span style="color:#E7C58C;">20</span><span style="color:#E6DFDE;"> });</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> artifacts = </span><span style="color:#FF7B84;">await</span><span style="color:#E6DFDE;"> store.artifacts.find(runId);</span></span></code></pre></div><h2 id="rules-every-repository-keeps" tabindex="-1">Rules every repository keeps <a class="header-anchor" href="#rules-every-repository-keeps" aria-label="Permalink to &quot;Rules every repository keeps&quot;">​</a></h2><ol><li><strong>One expiry rule.</strong> A claim, key or lock created at time <code>T</code> with <code>ttlMs</code> is expired at exactly <code>T + ttlMs</code> and can be taken over at that instant.</li><li><strong>Time comes from the clock.</strong> Expiry decisions use an injected <code>IClock</code>, never the database&#39;s clock, so tests can drive time and replicas agree on one rule.</li><li><strong>No aliasing.</strong> Values are copied in and out. Mutating an object after passing it to the store, or one the store returned, never changes what the store holds.</li><li><strong>Atomic means atomic across callers.</strong> <code>runs.insert</code>, <code>idempotency.claim</code>, <code>runs.claim</code>, <code>runs.renewClaim</code>, <code>locks.acquire</code> and <code>artifacts.insert</code> must hold under concurrency, also across processes.</li><li><strong>Ordering.</strong> <code>runs.find</code> orders by <code>createdAt</code> ascending, ties broken by <code>id</code> ascending, or both descending with <code>order: &#39;desc&#39;</code> (newest first); <code>total</code> ignores <code>limit</code> and <code>offset</code>. <code>artifacts.find</code> orders the same way. <code>agentRevisions.find</code> orders by agent name in code-point order.</li><li><strong>Guards throw.</strong> <code>runs.update</code> throws <code>InvalidRunStateError</code> when <code>expectStatus</code> does not match, or when <code>expectOwner</code> is given and the claim is absent or held by another owner (expiry is not checked there: a lease is lost once taken over). It throws <code>RunNotFoundError</code> for an unknown run.</li><li><strong>Checkpoints.</strong> <code>checkpoints.save</code> keeps the highest <code>stepIndex</code>; an equal index replaces.</li><li><strong>State filters.</strong> <code>state.findDocuments</code> <code>where</code> matches top-level fields by equality.</li><li><strong>Artifacts.</strong> <code>artifacts.insert</code> resolves <code>false</code> and keeps the stored artifact when the id exists. Bytes are copied in and out like every other value, and <code>read</code> returns a plain <code>Uint8Array</code> (no <code>Buffer</code> or other subclass). <code>findOne</code> and <code>find</code> return metadata only.</li></ol><h2 id="the-interfaces" tabindex="-1">The interfaces <a class="header-anchor" href="#the-interfaces" aria-label="Permalink to &quot;The interfaces&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { AgentRevision } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../agent/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { Artifact } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../artifact/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IConversationRepository } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../conversation/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#E6DFDE;">    Checkpoint,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Run,</span></span>
<span class="line"><span style="color:#E6DFDE;">    RunStatusLiteral,</span></span>
<span class="line"><span style="color:#E6DFDE;">    Step,</span></span>
<span class="line"><span style="color:#E6DFDE;">} </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../run/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RunFindOptions = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    status?: RunStatusLiteral[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    concurrencyKey?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    limit?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    offset?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    order?: </span><span style="color:#E7C58C;">&#39;asc&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;desc&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> StateFindOptions = { limit?: number; offset?: number };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> StateDocumentFindOptions = { where?: Record&lt;string, unknown&gt;; limit?: number };</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * Query contract: findOne returns undefined when absent; find returns an empty</span></span>
<span class="line"><span style="color:#958A8B;"> * result when nothing matches. Their OrFail counterparts throw on absence or an</span></span>
<span class="line"><span style="color:#958A8B;"> * empty selected page, even if records exist outside that page. Falsy values</span></span>
<span class="line"><span style="color:#958A8B;"> * (including null) count as present. They preserve each query&#39;s ordering and copies.</span></span>
<span class="line"><span style="color:#958A8B;"> *</span></span>
<span class="line"><span style="color:#958A8B;"> * Expiry rule shared by every TTL (run claims, idempotency keys, locks):</span></span>
<span class="line"><span style="color:#958A8B;"> * a lease/key created at time T with ttlMs expires AT T + ttlMs, i.e. at exactly</span></span>
<span class="line"><span style="color:#958A8B;"> * \`expiresAt\` it already counts as expired and can be taken over.</span></span>
<span class="line"><span style="color:#958A8B;"> *</span></span>
<span class="line"><span style="color:#958A8B;"> * Implementations must return copies: mutating a value passed in after the call,</span></span>
<span class="line"><span style="color:#958A8B;"> * or a value returned from a repository, must never change what it holds.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IRunRepository {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Atomic insert-if-absent: resolves false and keeps the stored run when a run</span></span>
<span class="line"><span style="color:#958A8B;">     * with that id exists (two dispatches may create the run an idempotency key names).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    insert(run: Run): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOne(id: string): Promise&lt;Run | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOneOrFail(id: string): Promise&lt;Run&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Throws InvalidRunStateError when \`expectStatus\` does not match the current</span></span>
<span class="line"><span style="color:#958A8B;">     * status, or when \`expectOwner\` is given and the run&#39;s claim is absent or held</span></span>
<span class="line"><span style="color:#958A8B;">     * by another owner (expiry is not checked: a lease is lost once taken over).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    update(id: string, patch: Partial&lt;Run&gt;, opts?: { expectStatus?: RunStatusLiteral[]; expectOwner?: string }): Promise&lt;Run&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Ordered by createdAt, ties broken by id, both ascending (\`order\` \`asc\`,</span></span>
<span class="line"><span style="color:#958A8B;">     * the default) or both descending (\`desc\`). \`total\` ignores limit/offset.</span></span>
<span class="line"><span style="color:#958A8B;">     * Without \`limit\`, every matching run (from \`offset\`) is returned: there is</span></span>
<span class="line"><span style="color:#958A8B;">     * no default page size.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    find(q: RunFindOptions): Promise&lt;{ data: Run[]; total: number }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOrFail(q: RunFindOptions): Promise&lt;{ data: Run[]; total: number }&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Atomic: only succeeds when unleased or the lease expired. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    claim(id: string, owner: string, ttlMs: number): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Extends the lease; only succeeds for the current, unexpired owner. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    renewClaim(id: string, owner: string, ttlMs: number): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IStepRepository {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The parent run must already exist. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    insert(step: Step): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    find(runId: string): Promise&lt;Step[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOrFail(runId: string): Promise&lt;Step[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ICheckpointRepository {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Keeps the highest stepIndex; an equal stepIndex replaces (approval responses are appended that way).</span></span>
<span class="line"><span style="color:#958A8B;">     * The parent run must already exist.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    save(cp: Checkpoint): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOne(runId: string): Promise&lt;Checkpoint | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOneOrFail(runId: string): Promise&lt;Checkpoint&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IIdempotencyRepository {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Atomic: the first caller per (scope, key) creates; others get the winner&#39;s runId. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    claim(scope: string, key: string, runId: string, ttlMs: number): Promise&lt;{ created: boolean; runId: string }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ILockRepository {</span></span>
<span class="line"><span style="color:#E6DFDE;">    acquire(key: string, owner: string, ttlMs: number): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    release(key: string, owner: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IEffectRepository {</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOne(key: string): Promise&lt;{ result: unknown } | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOneOrFail(key: string): Promise&lt;{ result: unknown }&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    save(key: string, result: unknown): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IStateRepository {</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOne(agent: string, key: string): Promise&lt;unknown&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOneOrFail(agent: string, key: string): Promise&lt;unknown&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`undefined\` removes the key. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    set(agent: string, key: string, value: unknown): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * One agent&#39;s entries ordered by key in code-point order (\`COLLATE &quot;C&quot;\`),</span></span>
<span class="line"><span style="color:#958A8B;">     * values copied out; every entry (from \`offset\`) without \`limit\`.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    find(agent: string, q?: StateFindOptions): Promise&lt;Array&lt;{ key: string; value: unknown }&gt;&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOrFail(agent: string, q?: StateFindOptions): Promise&lt;Array&lt;{ key: string; value: unknown }&gt;&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`where\` matches by top-level equality. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    findDocuments(</span></span>
<span class="line"><span style="color:#E6DFDE;">        agent: string,</span></span>
<span class="line"><span style="color:#E6DFDE;">        coll: string,</span></span>
<span class="line"><span style="color:#E6DFDE;">        q?: StateDocumentFindOptions,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ): Promise&lt;Array&lt;{ id: string; doc: unknown }&gt;&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findDocumentsOrFail(</span></span>
<span class="line"><span style="color:#E6DFDE;">        agent: string,</span></span>
<span class="line"><span style="color:#E6DFDE;">        coll: string,</span></span>
<span class="line"><span style="color:#E6DFDE;">        q?: StateDocumentFindOptions,</span></span>
<span class="line"><span style="color:#E6DFDE;">    ): Promise&lt;Array&lt;{ id: string; doc: unknown }&gt;&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    upsertDocument(agent: string, coll: string, id: string, doc: unknown): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    deleteDocument(agent: string, coll: string, id: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** Files of runs (attachments and tool outputs): metadata and bytes, both copied in and out. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IArtifactRepository {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Atomic insert-if-absent: resolves false and keeps the stored artifact</span></span>
<span class="line"><span style="color:#958A8B;">     * (metadata and bytes) when an artifact with that id exists.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    insert(artifact: Artifact, data: Uint8Array): Promise&lt;boolean&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Metadata only. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOne(id: string): Promise&lt;Artifact | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOneOrFail(id: string): Promise&lt;Artifact&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The bytes, as a plain Uint8Array (no Buffer or other subclass). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    read(id: string): Promise&lt;Uint8Array | undefined&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Metadata of a run&#39;s artifacts, ordered by createdAt ascending, ties broken by id ascending. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    find(runId: string): Promise&lt;Artifact[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOrFail(runId: string): Promise&lt;Artifact[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** One revision marker per folder agent, keyed by agent name, copied in and out. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IAgentRevisionRepository {</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOne(agent: string): Promise&lt;AgentRevision | undefined&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOneOrFail(agent: string): Promise&lt;AgentRevision&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Upsert: replaces the hash and \`changedAt\` of an existing marker. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    save(revision: AgentRevision): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Deleting a missing marker is a no-op. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    delete(agent: string): Promise&lt;void&gt;;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Every marker, ordered by agent in code-point order (\`COLLATE &quot;C&quot;\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    find(): Promise&lt;AgentRevision[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">    findOrFail(): Promise&lt;AgentRevision[]&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** A store of repositories that may use independent storage implementations. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> IStore {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runs: IRunRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    steps: IStepRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    checkpoints: ICheckpointRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    idempotency: IIdempotencyRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    locks: ILockRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    effects: IEffectRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    state: IStateRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    artifacts: IArtifactRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    agentRevisions: IAgentRevisionRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">    conversations?: IConversationRepository;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div><h2 id="store-implementations" tabindex="-1">Store implementations <a class="header-anchor" href="#store-implementations" aria-label="Permalink to &quot;Store implementations&quot;">​</a></h2><table tabindex="0"><thead><tr><th>Store</th><th>Package</th><th>Status</th></tr></thead><tbody><tr><td><a href="/repositories/memory"><code>createMemoryStore()</code></a></td><td><code>@chamvi/core</code></td><td>Shipped. Development and tests</td></tr><tr><td><a href="/repositories/typeorm">TypeORM</a></td><td><code>@chamvi/store-db</code></td><td>Shipped. PostgreSQL, production</td></tr></tbody></table><p>Redis is never required. Any store that passes the <a href="/repositories/writing-a-repository">contract suite</a> from <code>@chamvi/test-kit</code> works with the engine.</p>`,21)])])}const h=e(t,[["render",l]]);export{u as __pageData,h as default};
