import{_ as a,o as n,c as e,a2 as o}from"./chunks/framework.Di-jvWLj.js";const u=JSON.parse('{"title":"@chamvi/ui","description":"","frontmatter":{},"headers":[],"relativePath":"reference/ui.md","filePath":"reference/ui.md","lastUpdated":1793088333000}'),p={name:"reference/ui.md"};function l(t,s,c,i,r,d){return n(),e("div",null,[...s[0]||(s[0]=[o(`<h1 id="chamvi-ui" tabindex="-1">@chamvi/ui <a class="header-anchor" href="#chamvi-ui" aria-label="Permalink to &quot;@chamvi/ui&quot;">​</a></h1><p>The dashboard, served by <code>@chamvi/http</code>. The public API of <code>packages/ui/src/index.ts</code>; the app itself is a prebuilt bundle in <code>dist/app</code>.</p><div class="language-bash"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#E6DFDE;">npm </span><span style="color:#E7C58C;">install</span><span style="color:#E7C58C;"> @chamvi/ui</span><span style="color:#E7C58C;"> @chamvi/http</span><span style="color:#E7C58C;"> @chamvi/core</span><span style="color:#E7C58C;"> --save</span></span></code></pre></div><p><code>@chamvi/core</code> and <code>@chamvi/http</code> are peer dependencies. See <a href="/guide/ui">Dashboard</a> for the pages, sign-in and serving rules.</p><h2 id="uiroutes" tabindex="-1">uiRoutes <a class="header-anchor" href="#uiroutes" aria-label="Permalink to &quot;uiRoutes&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> uiRoutes(options?: UiRoutesOptions): HttpRoute[];</span></span></code></pre></div><p>One unauthenticated, not rate-limited <code>GET</code> prefix route at <code>basePath</code> for <code>createHttpApp({ routes })</code>. Throws <code>InvalidAgentDefinitionError</code> for a <code>basePath</code> that is not a lower-case path, an <code>auth.authup.url</code> that is no absolute http(s) URL, an empty <code>clientId</code>, <code>auth.tokens: false</code> without <code>auth.authup</code>, and an empty <code>root</code>.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">import</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> { UiAuthupConfig } </span><span style="color:#FF7B84;">from</span><span style="color:#E7C58C;"> &#39;../config/types.ts&#39;</span><span style="color:#E6DFDE;">;</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> UiRoutesOptions = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The dashboard&#39;s path under the app&#39;s \`basePath\` (lower case). Default \`/ui\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    basePath?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    auth?: {</span></span>
<span class="line"><span style="color:#958A8B;">        /** Offer the token-paste sign-in. Default \`true\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">        tokens?: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">        authup?: UiAuthupConfig;</span></span>
<span class="line"><span style="color:#E6DFDE;">    };</span></span>
<span class="line"><span style="color:#958A8B;">    /** The build folder. Default the package&#39;s \`dist/app\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    root?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** One file of the build. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> BuildFile = {</span></span>
<span class="line"><span style="color:#E6DFDE;">    bytes: Uint8Array;</span></span>
<span class="line"><span style="color:#E6DFDE;">    type: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Under \`assets/\`: content-hashed, cached for a year. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    immutable: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="config" tabindex="-1">Config <a class="header-anchor" href="#config" aria-label="Permalink to &quot;Config&quot;">​</a></h2><p>The block <code>uiRoutes()</code> injects into <code>index.html</code> (element id <code>CONFIG_ELEMENT_ID</code>).</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
<span class="line"><span style="color:#958A8B;"> * Copyright (c) 2026.</span></span>
<span class="line"><span style="color:#958A8B;"> * Author Peter Placzek (tada5hi)</span></span>
<span class="line"><span style="color:#958A8B;"> * For the full copyright and license information,</span></span>
<span class="line"><span style="color:#958A8B;"> * view the LICENSE file that was distributed with this source code.</span></span>
<span class="line"><span style="color:#958A8B;"> */</span></span>
<span class="line"></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> UiAuthupConfig = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The authup API URL, e.g. \`https://auth.example.com/api\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    url: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** The authup client the dashboard signs in as (code flow with PKCE). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    clientId: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    realmId?: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span>
<span class="line"></span>
<span class="line"><span style="color:#958A8B;">/** What the server injects into \`index.html\` for the SPA. */</span></span>
<span class="line"><span style="color:#FF7B84;">export</span><span style="color:#FF7B84;"> type</span><span style="color:#E6DFDE;"> UiConfig = {</span></span>
<span class="line"><span style="color:#958A8B;">    /** The chamvi API base (the app&#39;s \`basePath\`, \`&#39;&#39;\` by default). */</span></span>
<span class="line"><span style="color:#E6DFDE;">    apiBase: string;</span></span>
<span class="line"><span style="color:#958A8B;">    /** Where the dashboard is mounted, e.g. \`/ui\`. */</span></span>
<span class="line"><span style="color:#E6DFDE;">    uiBase: string;</span></span>
<span class="line"><span style="color:#E6DFDE;">    auth: {</span></span>
<span class="line"><span style="color:#958A8B;">        /** Offer the token-paste sign-in (static bearer tokens). */</span></span>
<span class="line"><span style="color:#E6DFDE;">        tokens: boolean;</span></span>
<span class="line"><span style="color:#E6DFDE;">        authup?: UiAuthupConfig;</span></span>
<span class="line"><span style="color:#E6DFDE;">    };</span></span>
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div><h2 id="constants" tabindex="-1">Constants <a class="header-anchor" href="#constants" aria-label="Permalink to &quot;Constants&quot;">​</a></h2><table tabindex="0"><thead><tr><th>Constant</th><th>Value</th></tr></thead><tbody><tr><td><code>DEFAULT_UI_BASE_PATH</code></td><td><code>&#39;/ui&#39;</code></td></tr><tr><td><code>ASSET_CACHE_CONTROL</code></td><td><code>&#39;public, max-age=31536000, immutable&#39;</code></td></tr><tr><td><code>DOCUMENT_CACHE_CONTROL</code></td><td><code>&#39;no-cache&#39;</code></td></tr><tr><td><code>CONFIG_ELEMENT_ID</code></td><td><code>&#39;chamvi-config&#39;</code></td></tr></tbody></table><h2 id="module" tabindex="-1">Module <a class="header-anchor" href="#module" aria-label="Permalink to &quot;Module&quot;">​</a></h2><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">// @chamvi/ui/module, needs @chamvi/app</span></span>
<span class="line"><span style="color:#FF7B84;">function</span><span style="color:#E6DFDE;"> uiModule(options?: UiModuleOptions): IModule; </span><span style="color:#958A8B;">// name UI_MODULE_NAME &#39;chamvi:ui&#39;</span></span></code></pre></div><p>Contributes <code>uiRoutes()</code> to the app&#39;s routes (<code>/ui</code> under <code>CHAMVI_BASE_PATH</code>). Reads <code>CHAMVI_UI_AUTHUP_CLIENT_ID</code>, <code>CHAMVI_UI_AUTHUP_REALM_ID</code> and <code>AUTHUP_URL</code> from <code>options.env ?? process.env</code> when it is called, unless <code>auth</code> is given. It provides no context (tools have nothing to reach). <code>@chamvi/app</code> is an optional peer: the main entry never imports it.</p><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki chamvi vp-code" tabindex="0"><code><span class="line"><span style="color:#958A8B;">/*</span></span>
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
<span class="line"><span style="color:#E6DFDE;">};</span></span></code></pre></div>`,17)])])}const y=a(p,[["render",l]]);export{u as __pageData,y as default};
