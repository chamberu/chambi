import{_ as n,o as a,c as e,a2 as l}from"./chunks/framework.Di-jvWLj.js";const E=JSON.parse('{"title":"@chamvi/coding","description":"","frontmatter":{},"headers":[],"relativePath":"reference/coding.md","filePath":"reference/coding.md","lastUpdated":1793027063000}'),o={name:"reference/coding.md"};function p(t,s,c,r,i,d){return a(),e("div",null,[...s[0]||(s[0]=[l(`<h1 id="chamvi-coding" tabindex="-1">@chamvi/coding <a class="header-anchor" href="#chamvi-coding" aria-label="Permalink to &quot;@chamvi/coding&quot;">​</a></h1><p>Coding tools for chamvi agents and the coding backend contract. The public API of <code>packages/coding/src/index.ts</code>.</p><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/coding</span><span style="color:#E7C58C;"> @chamvi/sandbox</span><span style="color:#E7C58C;"> @chamvi/core</span><span style="color:#E7C58C;"> ai</span><span style="color:#E7C58C;"> --save</span></span></code></pre></div><p><code>@chamvi/core</code>, <code>@chamvi/sandbox</code> and <code>ai</code> are peer dependencies. See <a href="/guide/workspaces">Workspaces &amp; Coding</a> for the behaviour.</p><h2 id="codingtools" tabindex="-1">codingTools <a class="header-anchor" href="#codingtools" aria-label="Permalink to &quot;codingTools&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> codingTools(workspaces: CodingWorkspaces, options?: CodingToolsOptions): ToolSet;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">type</span><span style="color:#E6DFDE;"> CodingWorkspaces = Pick&lt;IWorkspaceManager, </span><span style="color:#E7C58C;">&#39;get&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span></code></pre></div><p>Throws <code>InvalidAgentDefinitionError</code> when <code>workspaces</code> has no <code>get</code>, <code>options</code> is no object or <code>options.outputLogMaxBytes</code> is no positive integer. Returns <code>read_file</code>, <code>write_file</code>, <code>edit_file</code>, <code>multi_edit</code>, <code>grep</code>, <code>glob</code>, <code>list_files</code>, <code>bash</code>, <code>bash_output</code>, <code>bash_kill</code> and <code>git_diff</code>, each a <a href="/guide/tools"><code>defineTool()</code></a> tool that resolves its workspace through <code>workspaces.get(context.run.runId, input.workspace)</code>.</p><table tabindex="0"><thead><tr><th>Tool</th><th>Input</th><th>Result</th></tr></thead><tbody><tr><td><code>read_file</code></td><td><code>path</code>, <code>offset?</code> (1-based, default 1), <code>limit?</code> (default and maximum 2000), <code>encoding?</code> (<code>utf8</code> default, <code>base64</code>)</td><td><code>ReadFileResult</code>; <code>ReadFileBinaryResult</code> for <code>base64</code> (at most 1 MiB); <code>ReadFileImageResult</code> for a png, jpeg, gif or webp (at most 5 MiB), stored as a run artifact (<code>artifactId</code>), an image part for the model through <code>toModelOutput</code> and <code>artifactFilePart()</code>, so steps and checkpoints keep the id only</td></tr><tr><td><code>write_file</code></td><td><code>path</code>, <code>content</code>, <code>encoding?</code> (<code>utf8</code> default, <code>base64</code>)</td><td><code>WriteFileResult</code></td></tr><tr><td><code>edit_file</code></td><td><code>path</code>, <code>oldString</code>, <code>newString</code>, <code>replaceAll?</code></td><td><code>EditFileResult</code></td></tr><tr><td><code>multi_edit</code></td><td><code>path</code>, <code>edits</code> (1 to 100 of <code>{ oldString, newString, replaceAll? }</code>, applied in order, all or none)</td><td><code>MultiEditResult</code></td></tr><tr><td><code>grep</code></td><td><code>pattern</code> (ripgrep syntax, else POSIX ERE: see <code>engine</code>), <code>path?</code>, <code>ignoreCase?</code>, <code>includeIgnored?</code>, <code>limit?</code> (default 100, at most 500)</td><td><code>GrepResult</code></td></tr><tr><td><code>glob</code></td><td><code>pattern</code> (<code>*</code>, <code>?</code>, <code>**/</code>), <code>path?</code>, <code>includeIgnored?</code>, <code>limit?</code> (default 1000, at most 5000)</td><td><code>GlobResult</code></td></tr><tr><td><code>list_files</code></td><td><code>path?</code>, <code>includeIgnored?</code>, <code>limit?</code> (default 1000, at most 5000)</td><td><code>ListFilesResult</code></td></tr><tr><td><code>bash</code></td><td><code>command</code>, <code>cwd?</code> (this call only), <code>timeoutMs?</code> (default 300 000, at most 1 800 000), <code>background?</code></td><td><code>BashResult</code>; <code>BashJobResult</code> with <code>background: true</code></td></tr><tr><td><code>bash_output</code></td><td><code>job</code>, <code>offset?</code> (bytes, default 0)</td><td><code>BashOutputResult</code> (at most 32 KiB of output)</td></tr><tr><td><code>bash_kill</code></td><td><code>job</code></td><td><code>BashKillResult</code></td></tr><tr><td><code>git_diff</code></td><td><code>staged?</code>, <code>path?</code></td><td><code>GitDiffResult</code></td></tr></tbody></table><p>Every tool also takes <code>workspace?</code>, the id from <code>create_workspace</code>. A path is relative to the workspace root or starts with <code>/workspace/</code>; <code>read_file</code> and <code>grep</code> also take the log paths <code>bash</code> and <code>bash_output</code> name (<code>~/.chamvi/out/&lt;id&gt;.stdout.log</code>, <code>~/.chamvi/jobs/&lt;id&gt;/output</code>), and nothing else outside the workspace. See <a href="/guide/workspaces#the-shell">The shell</a> for the kept state, the output logs and the jobs. Input the model can correct (a bad path, an <code>oldString</code> that is missing or ambiguous) is a <code>ValidationError</code> tool error; a missing or oversized file and any other sandbox failure a <code>SandboxError</code> tool error.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IWorkspaceManager } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What the coding tools need of a workspace manager: the run&#39;s workspaces by id. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CodingWorkspaces = Pick&lt;IWorkspaceManager, </span><span style="color:#E7C58C;">&#39;get&#39;</span><span style="color:#E6DFDE;">&gt;;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CodingToolsOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Bytes one output log of \`bash\` may grow to (per stream). A call whose</span></span>
<span class="line"><span style="color:#958A8B;">     * log passes it is killed (\`outputCapped: true\`) and the log cut back to</span></span>
<span class="line"><span style="color:#958A8B;">     * it. Default \`OUTPUT_LOG_MAX_BYTES\` (64 MiB).</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    outputLogMaxBytes?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ReadFileResult = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Relative to \`/workspace\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    content: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** 1-based, inclusive. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    startLine: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    endLine: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    totalLines: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** True when \`content\` was cut at \`READ_MAX_CHARS\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`read_file\` with \`encoding: &#39;base64&#39;\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ReadFileBinaryResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    encoding: </span><span style="color:#E7C58C;">&#39;base64&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The file&#39;s bytes, base64. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    content: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    bytes: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** \`read_file\` of a png, jpeg, gif or webp image: the model gets it as an image part. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ReadFileImageResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    type: </span><span style="color:#E7C58C;">&#39;image&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    mediaType: </span><span style="color:#E7C58C;">&#39;image/png&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;image/jpeg&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;image/gif&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;image/webp&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    bytes: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * The run artifact holding the image (\`context.artifacts\`): the model</span></span>
<span class="line"><span style="color:#958A8B;">     * gets the bytes through its marker, so the tool step and the</span></span>
<span class="line"><span style="color:#958A8B;">     * checkpoints keep this id, never the image.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    artifactId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> WriteFileResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    bytes: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> EditFileResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    replacements: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> MultiEditResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** How many edits were applied (all of them). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    edits: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Replacements of all edits together. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    replacements: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GrepMatch = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    path: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    line: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    text: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** The program \`grep\` searched with: its regular expression syntax differs. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GrepEngine = </span><span style="color:#E7C58C;">&#39;ripgrep&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;git-grep&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;grep&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GrepResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    matches: GrepMatch[];</span></span>
<span class="line"><span style="color:#958A8B;">    /** True when more matches exist than were returned. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    engine: GrepEngine;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> ListFilesResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    files: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> BashResult = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The command&#39;s exit status (124 or 137 after a timeout). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * Stdout, whole when it has at most \`EXCERPT_HEAD_BYTES\` +</span></span>
<span class="line"><span style="color:#958A8B;">     * \`EXCERPT_TAIL_BYTES\` bytes, else its start and end around a</span></span>
<span class="line"><span style="color:#958A8B;">     * \`[... &lt;n&gt; bytes cut, full output in &lt;stdoutLog&gt;]\` line.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdout: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderr: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** True when the middle of stdout was cut (the whole of it is in \`stdoutLog\`). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdoutTruncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderrTruncated: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Bytes the command wrote to stdout. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdoutBytes: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderrBytes: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`~/.chamvi/out/&lt;id&gt;.stdout.log\`: the whole stdout, readable with read_file, grep or bash. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    stdoutLog: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    stderrLog: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The working directory the next call starts in (\`/workspace/...\` inside the workspace). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    cwd: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * True when a log passed \`outputLogMaxBytes\`: the call was killed with</span></span>
<span class="line"><span style="color:#958A8B;">     * its jobs, like a timeout, and the log keeps the first bytes up to the cap.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    outputCapped: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    timedOut: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">    durationMs: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What \`bash\` returns for \`background: true\`. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> BashJobResult = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The job id for bash_output and bash_kill. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    job: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: </span><span style="color:#E7C58C;">&#39;running&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`~/.chamvi/jobs/&lt;id&gt;/output\`: stdout and stderr of the job. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    outputLog: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * \`running\`; \`exited\` (with \`exitCode\`); \`killed\` by bash_kill; \`lost\` when</span></span>
<span class="line"><span style="color:#958A8B;"> * it ended without an exit status (its container restarted).</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> BashJobStatus = </span><span style="color:#E7C58C;">&#39;running&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;exited&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;killed&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;lost&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> BashOutputResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    job: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: BashJobStatus;</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode?: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Output from \`offset\` on, at most \`JOB_OUTPUT_MAX_BYTES\` bytes. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    output: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    offset: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Pass it as \`offset\` to read on. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    nextOffset: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Bytes of output so far. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    size: number;</span></span>
<span class="line"><span style="color:#958A8B;">    /** True when more output follows \`nextOffset\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#958A8B;">    /**</span></span>
<span class="line"><span style="color:#958A8B;">     * True when the output passed \`outputLogMaxBytes\`: the job was killed</span></span>
<span class="line"><span style="color:#958A8B;">     * with every process it started (status \`killed\`) and its output cut</span></span>
<span class="line"><span style="color:#958A8B;">     * back to the cap.</span></span>
<span class="line"><span style="color:#958A8B;">     */</span></span>
<span class="line"><span style="color:#E6DFDE;">    outputCapped: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> BashKillResult = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    job: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: BashJobStatus;</span></span>
<span class="line"><span style="color:#E6DFDE;">    exitCode?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GlobResult = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** Relative to the workspace root, sorted. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    files: string[];</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> GitDiffResult = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`git status --short\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    diff: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    truncated: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> READ_MAX_LINES: </span><span style="color:#E7C58C;">2_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> READ_MAX_CHARS: </span><span style="color:#E7C58C;">65_536</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> SEARCH_MAX_RESULTS: </span><span style="color:#E7C58C;">500</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> LIST_MAX_RESULTS: </span><span style="color:#E7C58C;">5_000</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> LINE_MAX_CHARS: </span><span style="color:#E7C58C;">500</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#FF7B84;">const</span><span style="color:#E6DFDE;"> OUTPUT_LOG_MAX_BYTES: </span><span style="color:#E7C58C;">67_108_864</span><span style="color:#E6DFDE;">; </span><span style="color:#958A8B;">// 64 MiB, the default outputLogMaxBytes</span></span></code></pre></div><h2 id="icodingbackend" tabindex="-1">ICodingBackend <a class="header-anchor" href="#icodingbackend" aria-label="Permalink to &quot;ICodingBackend&quot;">​</a></h2><p>The contract for something that solves a coding task in a workspace with its own tool loop. Only the contract ships; backends (the own tools in a nested loop, Claude Code) are planned.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { IWorkspace } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;@chamvi/sandbox&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CodingBudget = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxSteps?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    maxTokens?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">    timeoutMs?: number;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CodingTask = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The workspace to work in; the backend never disposes it. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    workspace: IWorkspace;</span></span>
<span class="line"><span style="color:#958A8B;">    /** What to do, in plain language. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    task: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    budget?: CodingBudget;</span></span>
<span class="line"><span style="color:#E6DFDE;">    signal?: AbortSignal;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> CodingResult = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** \`done\` when the task is solved, \`stuck\` when the backend gave up. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    status: </span><span style="color:#E7C58C;">&#39;done&#39;</span><span style="color:#E6DFDE;"> | </span><span style="color:#E7C58C;">&#39;stuck&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"><span style="color:#E6DFDE;">    summary: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The workspace&#39;s changes as a unified diff. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    diff: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/**</span></span>
<span class="line"><span style="color:#958A8B;"> * Something that solves a coding task in a workspace with its own tool loop</span></span>
<span class="line"><span style="color:#958A8B;"> * (the own coding tools, Claude Code, ...).</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> interface</span><span style="color:#E6DFDE;"> ICodingBackend {</span></span>
<span class="line"><span style="color:#E6DFDE;">    code(task: CodingTask): Promise&lt;CodingResult&gt;;</span></span>
<span class="line"><span style="color:#E6DFDE;">}</span></span></code></pre></div>`,14)])])}const D=n(o,[["render",p]]);export{E as __pageData,D as default};
