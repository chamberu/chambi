import{_ as n,o as e,c as a,a2 as t}from"./chunks/framework.Di-jvWLj.js";const y=JSON.parse('{"title":"Execution & Checkpoints","description":"","frontmatter":{},"headers":[],"relativePath":"guide/execution.md","filePath":"guide/execution.md","lastUpdated":1793264610000}'),o={name:"guide/execution.md"};function l(p,s,r,c,i,d){return e(),a("div",null,[...s[0]||(s[0]=[t(`<h1 id="execution-checkpoints" tabindex="-1">Execution &amp; Checkpoints <a class="header-anchor" href="#execution-checkpoints" aria-label="Permalink to &quot;Execution &amp; Checkpoints&quot;">​</a></h1><p>One execution is one call of an AI SDK <code>ToolLoopAgent</code> for one claimed, <code>running</code> run. A run may take several executions: one before an approval pause and one after, or one before a crash and one after recovery.</p><h2 id="what-an-execution-does" tabindex="-1">What an execution does <a class="header-anchor" href="#what-an-execution-does" aria-label="Permalink to &quot;What an execution does&quot;">​</a></h2><ol><li><strong>Load the start point.</strong> The latest checkpoint&#39;s messages, or, for a new run, a single user message with the rendered envelope (and a file part per <a href="/guide/channels#attachments">attachment</a>). File parts that refer to an artifact get its bytes for this call only; a missing artifact fails the run with <code>ArtifactNotFoundError</code>.</li><li><strong>Run pending tool calls.</strong> Tool calls the checkpoint holds without a result (suspended by <a href="/guide/approvals"><code>approve()</code></a>) run first, without a model call, through the same checks as a model&#39;s call (tool policy, input schema, hooks); their results join the checkpoint. One that suspends again sends the run back to <code>waiting</code>.</li><li><strong>Check the step budget.</strong> If an earlier execution already used every step, the run settles right away (see <a href="/guide/budgets">Budgets</a>).</li><li><strong>Assemble the tools.</strong> Generated <a href="/guide/state">state tools</a> plus the result of your <code>tools</code> factory; every call runs inside a tool-call frame with the agent <a href="/guide/approvals#gating-tools-you-did-not-write">hooks</a>, and every <a href="/guide/effect-tools">effect tool</a> is wrapped.</li><li><strong>Run the loop.</strong> <code>ToolLoopAgent.stream()</code> with your model and instructions, the agent&#39;s <code>output</code>, and stop conditions for the step and token budgets and for a suspended call (the loop ends after the step in which a tool called <code>approve()</code>). Text and reasoning are emitted as <code>run.delta</code> events while they stream (see <a href="#streaming">Streaming</a>).</li><li><strong>After every step:</strong> append the <code>llm</code> step and one <code>tool</code> step per tool result or error, save a checkpoint, and update the run&#39;s token usage. A model call that fails (an <code>error</code> part in its stream) still ends its step: the <code>llm</code> step (with the text so far and finish reason <code>error</code>) and its checkpoint are written, then the run fails with that error. A stream that ends without a finish part fails the run with <code>IncompleteResponseError</code> (<code>incomplete_response</code>), since the AI SDK would otherwise skip the step&#39;s tool calls.</li><li><strong>Settle.</strong> <code>completed</code> (with the final text, or the parsed <a href="/guide/agents#structured-output">structured output</a>, as <code>output</code>), <code>failed</code>, <code>cancelled</code>, <code>waiting</code> (a tool awaits an approval; the suspended calls stay pending in the checkpoint) or, during a drain, <code>interrupted</code>.</li></ol><h2 id="checkpoints" tabindex="-1">Checkpoints <a class="header-anchor" href="#checkpoints" aria-label="Permalink to &quot;Checkpoints&quot;">​</a></h2><p>A <code>Checkpoint</code> holds the full message history after a step, the step index and the AI SDK finish reason of that step.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ModelMessage } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;ai&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { ApprovalOption } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../approval/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { TriggerEnvelope } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../trigger/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { RunStatus } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;./constants.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RunStatusLiteral = </span><span style="color:#E7C58C;">\`</span><span style="color:#E6DFDE;">\${</span><span style="color:#E7C58C;">RunStatus</span><span style="color:#E6DFDE;">}</span><span style="color:#E7C58C;">\`</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Usage = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    inputTokens: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    outputTokens: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Budget = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxSteps: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxTokens?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Wall-clock limit per execution (not cumulative across resumes): each</span></span>
<span class="line"><span style="color:#958A8B;">     * execution of the run gets the full timeout again.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> RunContext = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    trigger: TriggerEnvelope;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Aborts on cancel, drain, a lost lease or the run timeout, and once the execution has ended. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The approval a \`waiting\` run waits on, as approve() requested it. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WaitPoint = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    kind: </span><span style="color:#E7C58C;">&#39;approval&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`&lt;stepIndex&gt;:&lt;toolCallId&gt;:&lt;n&gt;\` of the stored checkpoint&#39;s pending call: never changes after the pause. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    approvalId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    toolName: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    toolCallId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    title: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    body?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The choices of the request; absent for a plain yes or no. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    options?: ApprovalOption[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** Set (true) only when several options may be selected. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    multiple?: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The channel the request is delivered through; none for the inbox and API only. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    channel?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    address?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    expiresAt: Date;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Set once the approval message went out through \`channel\`; tick() re-sends while it is missing. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    notifiedAt?: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Run = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    id: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    agent: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: RunStatusLiteral;</span></span>
<span class="line"><span style="color:#E6DFDE;">    trigger: TriggerEnvelope;</span></span>
<span class="line"><span style="color:#E6DFDE;">    concurrencyKey?: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Where the run came from on its channel (\`trigger.address\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    address?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    output?: unknown;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Why the run failed, or why the registry cancelled it (\`agent_replaced\`,</span></span>
<span class="line"><span style="color:#958A8B;">     * \`agent_removed\`); a run cancelled on another replica keeps the reason</span></span>
<span class="line"><span style="color:#958A8B;">     * through the owner&#39;s settle, a run that completes anyway loses it.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    error?: { code: string; message: string };</span></span>
<span class="line"><span style="color:#E6DFDE;">    usage: Usage;</span></span>
<span class="line"><span style="color:#E6DFDE;">    waiting?: WaitPoint;</span></span>
<span class="line"><span style="color:#E6DFDE;">    claim?: { owner: string; expiresAt: Date };</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Set by cancel() on a replica that does not execute the run: the owner</span></span>
<span class="line"><span style="color:#958A8B;">     * aborts it on its next poll, and a later execution settles it cancelled.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cancelRequested?: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    createdAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">    updatedAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">    startedAt?: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">    finishedAt?: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Step = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    index: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    kind: </span><span style="color:#E7C58C;">&#39;llm&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;tool&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;wait&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    name?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    input?: unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">    output?: unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">    error?: unknown;</span></span>
<span class="line"><span style="color:#E6DFDE;">    startedAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">    finishedAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> Checkpoint = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    runId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stepIndex: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    messages: ModelMessage[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** AI SDK finish reason of the step this checkpoint was taken after. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    finishReason?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    createdAt: Date;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><p>Checkpoints never hold the bytes of an artifact: a file part keeps a reference (<code>data: &#39;chamvi-artifact:&lt;id&gt;&#39;</code>) and every execution reads the bytes again.</p><p>The store keeps the checkpoint with the highest <code>stepIndex</code> per run; saving one with an equal index replaces it. That is how the results of pending calls that ran after an approval join the history of the step that asked for it.</p><p>Because the engine saves a checkpoint after every completed step, a recovered run repeats at most the step that was in progress when the process died. If that step called tools, they run again, which is why tools with side effects should be <a href="/guide/effect-tools">effect tools</a>.</p><h3 id="writes-around-an-abort" tabindex="-1">Writes around an abort <a class="header-anchor" href="#writes-around-an-abort" aria-label="Permalink to &quot;Writes around an abort&quot;">​</a></h3><p>A cancel or drain aborts the model call, but the writes of a step that already completed (its tool rows and checkpoint) are allowed to finish before the run settles. A recovery then does not redo a step whose tools already ran. Once the run has settled, a model call that is still running cannot write anymore.</p><h2 id="streaming" tabindex="-1">Streaming <a class="header-anchor" href="#streaming" aria-label="Permalink to &quot;Streaming&quot;">​</a></h2><p>The engine always streams (every AI SDK provider does). Each text and reasoning delta becomes a local <code>run.delta</code> event:</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> offDelta = engine.on(</span><span style="color:#E7C58C;">&#39;run.delta&#39;</span><span style="color:#E6DFDE;">, ({ delta }) </span><span style="color:#FF7B84;">=&gt;</span><span style="color:#E6DFDE;"> {</span></span>
<span class="line"><span style="color:#958A8B;">    // text or reasoning as the model streams it; never stored</span></span>
<span class="line"><span style="color:#FF7B84;">    if</span><span style="color:#E6DFDE;"> (delta.kind === </span><span style="color:#E7C58C;">&#39;text&#39;</span><span style="color:#E6DFDE;">) process.stdout.write(delta.text);</span></span>
<span class="line"><span style="color:#E6DFDE;">});</span></span></code></pre></div><p><code>delta</code> is <code>{ runId, step, kind: &#39;text&#39; | &#39;reasoning&#39;, text }</code>; <code>step</code> is the checkpoint <code>stepIndex</code> the step is saved under. Deltas arrive in order, and their concatenated text equals the text of the stored <code>llm</code> step. They are never stored and only reach listeners in the process that executes the run; after a cancel, drain or lost lease settled the run, no more arrive. A model error during the stream fails the run, after the errored step&#39;s <code>llm</code> row (finish reason <code>error</code>) and checkpoint are written. So does a stream that closes without the provider&#39;s finish part (a cut connection): the run fails with <code>incomplete_response</code> instead of completing with a partial answer, and a tool call of that step never runs. <code>@chamvi/http</code> forwards them on the run&#39;s SSE stream as <code>delta</code> events.</p><h2 id="ownership" tabindex="-1">Ownership <a class="header-anchor" href="#ownership" aria-label="Permalink to &quot;Ownership&quot;">​</a></h2><p>Every write of a <code>running</code> run is conditional on the status and on the engine holding the run&#39;s claim. If another engine took the run over (because this one&#39;s lease expired), the execution is aborted, writes nothing more and reports a <code>LeaseLostError</code> to <code>onError</code>. The run is not failed: its new owner carries it on. See <a href="/guide/concurrency">Concurrency, Leases &amp; Multi-Replica</a>.</p><h2 id="the-first-message" tabindex="-1">The first message <a class="header-anchor" href="#the-first-message" aria-label="Permalink to &quot;The first message&quot;">​</a></h2><p>The model sees the envelope as a JSON block:</p><div class="language-md"><button title="Copy Code" class="copy"></button><span class="lang">md</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">\`\`\`json</span></span>
<span class="line"><span style="color:#E6DFDE;">{</span></span>
<span class="line"><span style="color:#E6DFDE;">  &quot;</span><span style="color:#E7C58C;">channel</span><span style="color:#E6DFDE;">&quot;</span><span style="color:#E6DFDE;">: </span><span style="color:#E7C58C;">&quot;http&quot;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">  &quot;</span><span style="color:#E7C58C;">trigger</span><span style="color:#E6DFDE;">&quot;</span><span style="color:#E6DFDE;">: </span><span style="color:#E7C58C;">&quot;http&quot;</span><span style="color:#E6DFDE;">,</span></span>
<span class="line"><span style="color:#E6DFDE;">  &quot;</span><span style="color:#E7C58C;">payload</span><span style="color:#E6DFDE;">&quot;</span><span style="color:#E6DFDE;">: {</span></span>
<span class="line"><span style="color:#E6DFDE;">    &quot;</span><span style="color:#E7C58C;">title</span><span style="color:#E6DFDE;">&quot;</span><span style="color:#E6DFDE;">: </span><span style="color:#E7C58C;">&quot;App crashes on start&quot;</span></span>
<span class="line"><span style="color:#E6DFDE;">  }</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span>
<span class="line"><span style="color:#E6DFDE;">\`\`\`</span></span></code></pre></div><p><code>id</code>, keys, <code>address</code>, the invoker and <code>receivedAt</code> are not part of the message; they are available to tools through <code>run.trigger</code>. With attachments the message content is that text followed by one <code>file</code> part per attachment (its <code>mediaType</code> and <code>filename</code>).</p>`,22)])])}const E=n(o,[["render",l]]);export{y as __pageData,E as default};
