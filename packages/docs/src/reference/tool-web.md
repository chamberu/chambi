# @chamvi/tool-web

A web fetch tool for chamvi agents: any public page as markdown, behind an address check, through a [hapic](https://github.com/tada5hi/hapic) client. The public API of `packages/tool-web/src/index.ts`.

```bash
npm install @chamvi/tool-web @chamvi/core ai --save
```

`@chamvi/core` and `ai` are peer dependencies. See [Web research tools](/guide/tools#web-research-tools) for an example.

## webTools

```ts
function webTools(options?: WebToolsOptions): ToolSet; // { web_fetch }

const WEB_FETCH_MAX_BYTES: 5_242_880;
const WEB_FETCH_MAX_CHARS: 65_536;
const WEB_TIMEOUT_MS: 30_000;
const WEB_MAX_REDIRECTS: 5;
const WEB_REQUEST_ERROR_CODE: 'web_request';
```

Throws `InvalidAgentDefinitionError` for options that are no object, a `client` that is no hapic client, a `lookup` or `allowUrl` that is no function, a `maxBytes` or `timeoutMs` that is no positive integer (`timeoutMs` at most 2^31 - 1) and a clock without `now()` and `setTimeout()`.

| Tool | Input | Result |
|---|---|---|
| `web_fetch` | `url`, `format?` (`markdown` default, `text`, `raw`), `offset?` | `WebFetchResult`: at most 65 536 characters from `offset`; an HTML page converted (links absolute) unless `raw`, other text as is; `nextOffset` while more follows, `truncated` when the body passed `maxBytes` or the HTML 1 Mi characters |

Every URL and every redirect target (at most 5) is resolved and refused (`ValidationError`) when an address is loopback, private, link-local or metadata, CGNAT, multicast or reserved, unless `allowUrl(url)` answers `true`; `false` refuses a URL outright. The request resolves the name again (DNS rebinding is not covered), and behind a proxy the proxy connects. An error status, a network failure, a binary response and the timeout are `ChamviError`s with code `web_request`, tool errors the model reads.

## Types

```ts
type WebToolsOptions = {
    client?: IClient;          // hapic; default createClient(), proxy from HTTP_PROXY / HTTPS_PROXY / NO_PROXY
    lookup?: WebLookup;        // default dns.lookup, every address
    allowUrl?: WebUrlPolicy;
    maxBytes?: number;         // default 5 MiB
    timeoutMs?: number;        // default 30 s, the whole fetch
    clock?: IClock;
};

type WebLookup = (hostname: string, signal: AbortSignal) => Promise<WebAddress[]>;
type WebAddress = { address: string; family: number };
type WebUrlPolicy = (url: URL) => boolean | undefined;
type WebFetchFormat = 'markdown' | 'text' | 'raw';

type WebFetchResult = {
    url: string;               // after redirects
    status: number;
    contentType: string | null;
    format: WebFetchFormat;
    title?: string;
    content: string;
    offset: number;
    totalChars: number;
    nextOffset?: number;
    truncated: boolean;
};
```
