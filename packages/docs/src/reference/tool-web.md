# @chamvi/tool-web

Web research tools for chamvi agents: URL fetch behind an address guard, package registry lookups and a pluggable web search. The public API of `packages/tool-web/src/index.ts`.

```bash
npm install @chamvi/tool-web @chamvi/core ai --save
```

`@chamvi/core` and `ai` are peer dependencies. See [Web research tools](/guide/tools#web-research-tools) for an example.

## webTools

```ts
function webTools(options?: WebToolsOptions): ToolSet;

const WEB_FETCH_MAX_BYTES: 5_242_880;
const WEB_FETCH_MAX_CHARS: 65_536;
const WEB_TIMEOUT_MS: 30_000;
const MAX_REDIRECTS: 5;
const WEB_SEARCH_MAX_RESULTS: 20;
const WEB_REQUEST_ERROR_CODE: 'web_request';
```

Throws `InvalidAgentDefinitionError` for options that are no object, a `fetch`, `lookup` or `allowUrl` that is no function, a `search` without `search()`, a `maxBytes` or `timeoutMs` that is no positive integer (`timeoutMs` at most 2^31 - 1), `registries` with an unknown ecosystem or a value that is no absolute http(s) URL without credentials, query or hash, and a `clock` without `now()` and `setTimeout()`. Returns `web_fetch`, `package_info` and, with `search`, `web_search`: plain [`defineTool()`](/guide/tools) tools, no effect tools.

| Tool | Input | Result |
|---|---|---|
| `web_fetch` | `url`, `format?` (`markdown` default, `text`, `raw`), `offset?` | `WebFetchResult`: at most 65 536 characters from `offset` |
| `package_info` | `ecosystem` (`npm`, `pypi`, `crates`, `packagist`, `go`, `rubygems`), `name`, `version?` (or an npm dist-tag) | `PackageInfo`: up to 100 versions, newest first, and the detail of `version` (default the latest) |
| `web_search` | `query`, `limit?` (default 10, at most 20) | `SearchResult[]` |

Every request (also each redirect, at most 5) resolves the host through `lookup` and refuses the URL (`ValidationError`) when any address is loopback, private, link-local, CGNAT, multicast, reserved or documentation space (IPv4 and IPv6; IPv4-mapped, NAT64 and 6to4 by the IPv4 address inside), unless `allowUrl(url)` returns `true` (`false` refuses any URL); the default transport connects to the checked address. Registry origins skip the check. Request failures are tool errors with code `web_request`: an error status (`HTTP <status> from <url>`), more than 5 redirects, a timeout (`No answer from <origin> within <ms>ms.`), a host that does not resolve, a response that is no text, a registry without the package (`<ecosystem> has no package <name>.`) or version.

<<< ../../../tool-web/src/tools/types.ts{ts}

<<< ../../../tool-web/src/request/types.ts#public{ts}

## Registries

```ts
const DEFAULT_REGISTRIES: Readonly<Record<PackageEcosystem, string>>; // npm, pypi, crates, packagist, go, rubygems
const PACKAGE_VERSIONS_MAX: 100;
const PACKAGE_DEPENDENCIES_MAX: 200;
```

<<< ../../../tool-web/src/registry/types.ts#public{ts}
