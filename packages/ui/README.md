<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/ui" width="128" height="128" />
</p>

<h1 align="center">@chamvi/ui</h1>

<p align="center">
    <b>The chamvi dashboard.</b><br>
    See what each agent does, start runs, watch them live, answer approvals,<br>look into agent state and schedules,<br>
    served by your own <code>@chamvi/http</code> app on the same origin.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/ui"><img src="https://img.shields.io/npm/v/@chamvi/ui" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/ui/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/ui" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [Views](#views)
- [Sign-in](#sign-in)
- [Options](#options)
- [Serving](#serving)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/ui @chamvi/http @chamvi/core --save
```

ESM only, Node.js `>=22`. `@chamvi/core` and `@chamvi/http` are peer dependencies. The package ships a prebuilt Vue 3 app (`dist/app`); nothing of it runs on the server but a static file route.

## Usage

`uiRoutes()` returns extra routes for `createHttpApp({ routes })`:

```typescript
import { Engine, createMemoryRepositories } from '@chamvi/core';
import { createHttpApp, staticTokens } from '@chamvi/http';
import { uiRoutes } from '@chamvi/ui';

const engine = new Engine({
    repositories: createMemoryRepositories(),
    agents: [],
});

const admin = {
    value: process.env.ADMIN_TOKEN ?? 'admin-token-0123456789',
    id: 'admin',
    permissions: ['*'],
};

export const app = createHttpApp({
    engine,
    auth: [staticTokens({ tokens: [admin] })],
    // the dashboard at /ui: runs, approvals, agent state and schedules
    routes: uiRoutes(),
});
```

Open `http://<host>/ui/` and sign in with a bearer token of the app.

## Views

| View | Shows | Needs |
|---|---|---|
| Agents | A card per agent: channel chips (its subscriptions), running and waiting runs, next cron fire, 24 h activity, last run, budget, state collections; the landing page | `run:read` |
| Agent | Budget, state collections, channel chips, Start run (with an `http.on()` subscription), and the tabs Overview, Runs, State, Schedules | `run:read`; `agent:<name>:run` to start; `state:read` for State |
| Runs | Every run, newest first, filtered by agent and status, with status and tokens; refreshes every 5 s | `run:read` |
| Run | Header with budgets, the envelope (channel, subscription, address, payload) and the step timeline (llm, tool, wait), live over SSE with streamed text; cancel | `run:read` or `agent:<name>:run`; `run:cancel` to cancel |
| Approvals | Waiting runs with the request's title and body, the tool and the channel it went out through; Approve or Deny with a reason | `run:read` to list, `agent:<name>:approve` to answer |
| Schedules | Cron subscriptions per agent with the next fire time | `run:read` |

The 24 h figures are counted from the newest 100 runs (the API has no time filter) and read `100+` beyond.

A channel's approval message links an approval by run: `/ui/approvals?run=<runId>&approval=<approvalId>` (`approval` optional, then the run's current one). The link carries no token. Signed out, it goes through sign-in (token form or authup) and comes back to the same URL; signed in, the dashboard scrolls to that run's approval card, highlights and focuses it, and the answer goes through `POST /runs/:id/approve` as the signed-in principal. A run that no longer waits on that approval (answered, expired, moved on to another one) shows a notice linking the run; the link needs read access to the run (`run:read` or `agent:<name>:run`) besides `agent:<name>:approve`: without the approve grant the card shows read-only under a 403 notice, without read access only a 403 notice shows. The run page and the agent page link waiting runs the same way.

## Sign-in

- **Token** (default): paste a static bearer token (`staticTokens()` of `@chamvi/http`). `GET /me` checks it before it is kept, in `sessionStorage` of the tab only; a reload while the API is unreachable keeps it.
- **authup**: `uiRoutes({ auth: { authup: { url, clientId, realmId? } } })` adds "Continue with authup" (OIDC code flow with PKCE); its tokens live in the tab's `sessionStorage` too, never in cookies. The authup client needs `<origin><uiBase>/login/callback` as a redirect URI, e.g. `https://chamvi.example.com/ui/login/callback`. Pair it with the app's `authup()` authenticator. `auth: { tokens: false }` hides the token form.

An expired or revoked credential answers 401: the dashboard refreshes an authup session once, else returns to sign-in and back to the page it was on.

## Options

| Option | Default | Purpose |
|---|---|---|
| `basePath` | `'/ui'` | The dashboard's path under the app's `basePath`, lower case (`/api` + `/console` serves `/api/console/`) |
| `auth.tokens` | `true` | Offer the token form |
| `auth.authup` | none | `{ url, clientId, realmId? }` of an authup server |
| `root` | the package's `dist/app` | Another build folder |

Invalid options throw `InvalidAgentDefinitionError` of `@chamvi/core`. A missing build is reported on the first request (500, `onError`), not at construction, so the build may arrive later.

## Serving

- Every `GET` below `basePath`: a file of the build, else `index.html` for a path without an extension (client routes), else 404. `index.html` gets `<base href="<uiBase>/">` and the config as a JSON block.
- Hashed files under `assets/` are `cache-control: public, max-age=31536000, immutable`, everything else `no-cache`.
- Paths are decoded once and refused on `..`, `.`, empty segments, backslashes, NUL and double encoding: nothing outside the build is ever read.
- Every answer carries `Content-Security-Policy` (`default-src 'self'`, scripts only from the app, `connect-src` and `form-action` add the authup origin, `frame-ancestors 'none'`), `referrer-policy: no-referrer` (an approval link's ids never leave as a referrer), `x-content-type-options: nosniff` and `x-frame-options: DENY`.
- The route is unauthenticated (the app holds no secret; every API call carries the signed-in bearer token) and skips the rate limiter.

Behind a proxy that mounts the app under a prefix, set the app's `basePath`; the dashboard follows it.

## With @chamvi/app

`uiModule()` from `@chamvi/ui/module` contributes the dashboard route (`/ui` under `CHAMVI_BASE_PATH`) and reads `CHAMVI_UI_AUTHUP_CLIENT_ID`, `CHAMVI_UI_AUTHUP_REALM_ID` and `AUTHUP_URL` when it is called, unless `auth` is given. `@chamvi/app` is an optional peer; the main entry never imports it.

```ts
import { createApp } from '@chamvi/app';
import { uiModule } from '@chamvi/ui/module';

export default createApp({ agents, modules: [uiModule()] });
```

## API

| Export | Kind | Purpose |
|---|---|---|
| `uiRoutes` | function | The dashboard route for `createHttpApp({ routes })` |
| `DEFAULT_UI_BASE_PATH` | constant | `'/ui'` |
| `ASSET_CACHE_CONTROL` | constant | `'public, max-age=31536000, immutable'` |
| `DOCUMENT_CACHE_CONTROL` | constant | `'no-cache'` |
| `CONFIG_ELEMENT_ID` | constant | `'chamvi-config'`, the id of the injected config block |

Types: `UiRoutesOptions`, `UiConfig`, `UiAuthupConfig`.

`@chamvi/ui/module`: `uiModule`, `UiModule`, `UI_MODULE_NAME`, type `UiModuleOptions`.

## License

Published under [Apache License 2.0](./LICENSE).
