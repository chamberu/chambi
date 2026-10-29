<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo-test-kit.svg" alt="@chamvi/test-kit" width="128" height="128" />
</p>

<h1 align="center">@chamvi/test-kit</h1>

<p align="center">
    <b>Test helpers for chamvi: a controllable clock, the store and workspace contract suites, a git fixture and an in-process fake GitHub.</b>
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/test-kit"><img src="https://img.shields.io/npm/v/@chamvi/test-kit" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/test-kit/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/test-kit" alt="License" /></a>
</p>

---

## Installation

```bash
npm install --save-dev @chamvi/test-kit @chamvi/core ai vitest
```

`@chamvi/core`, `ai` (v7) and `vitest` are peer dependencies. The workspace contract takes any `IWorkspace` of `@chamvi/sandbox` (typed structurally as `ContractWorkspace`, so the kit does not depend on `@chamvi/sandbox`).

## Usage

### Scripted models

`mockModel(responses)` provides one scripted AI SDK model for generation and streaming. Each `MockResponse` contains text or tool-call `parts` and optional token usage. `textModel(text)`, `approvalModel(toolName, input)` and `failingModel()` cover common test flows.

```ts
import { textModel } from '@chamvi/test-kit';

const model = textModel('done');
```

### Store contract

Every `IStore` implementation proves itself with the shared Vitest suite. The factory gets a fresh `ControllableClock` per test and must use it for every expiry decision:

```typescript
import { MemoryStore } from '@chamvi/core';
import { describeStoreContract } from '@chamvi/test-kit';

describeStoreContract((clock) => new MemoryStore({ clock }));
```

### Controllable clock

`ControllableClock` implements `IClock` and only moves when told to, so engine timeouts, claim leases and approval expiry are tested without real timers:

```typescript
import { MemoryStore, Engine } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';

const clock = new ControllableClock();
const store = new MemoryStore({ clock });
const engine = new Engine({ store, agents: [], clock });

clock.advance(60_000); // fires every timer due within the next minute, in order
```

### Workspace contract

Every sandbox provider proves its workspaces with the shared Vitest suite: argv exec and exit codes, stdin, `cwd` and path escapes, the 64 KiB output caps under a flood, process-group kills on timeout (a backgrounded grandchild included), abort, UTF-8 files and their size cap, and dispose during an exec. It runs real processes with short real timeouts, so the factory returns a fresh, repo-less workspace per test (the suite disposes it). With `find` (a second provider instance's, like a restarted process) it also drops a workspace's handle and expects `find` to return it with its files:

```ts
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { describeWorkspaceContract } from '@chamvi/test-kit';

const provider = createLocalSandbox();
describeWorkspaceContract('local', (input) => provider.create({ runId: input?.runId ?? 'contract' }), {
    find: (runId) => createLocalSandbox().find(runId),
});
```

`createGitFixture(files)` creates a temporary git repository with one commit of `files` on branch `main`, tagged `v1`, and returns `{ path, url, commit, cleanup }`; `url` is a `file://` URL for a manager with `allowFileRepos: true`.

### Fake GitHub

`createFakeGithub({ appId, slug?, clock })` is an in-process GitHub for `createGithubApp({ fetch })` from `@chamvi/github`: it generates an RSA key pair, checks App JWTs and installation tokens on `clock`, serves issues, comments, labels, pull requests, contents and releases from mutable maps, and never touches the network:

```ts
import { createGithubApp } from '@chamvi/github';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';

const clock = new ControllableClock(new Date('2026-10-21T09:00:00Z'));
const fake = createFakeGithub({ appId: '123', slug: 'my-app', clock });
const gh = createGithubApp({
    appId: '123',
    privateKey: fake.privateKey,
    webhookSecret: 'webhook-secret',
    slug: 'my-app',
    clock,
    fetch: fake.fetch,
});

fake.issues.set('octo/demo#7', { number: 7, title: 'Bug', state: 'open' });
fake.failNext('POST', '/repos/octo/demo/issues/7/comments', 502); // one injected failure
```

`route(method, path, handler)` adds or overrides a route (`:name` is one segment, `*name` the rest), `requests` records every request, `tokenInstallations` the installation of every issued token. A request whose `signal` aborts, also while a route handler is pending, rejects with the signal's reason, as Node's `fetch` does.

## API

| Export | Kind | Purpose |
|---|---|---|
| `ControllableClock` | class | `IClock` that advances only via `advance(ms)`; starts at `new Date(0)` unless given a date |
| `describeStoreContract` | function | Vitest suite every `IStore` implementation must pass |
| `describeWorkspaceContract` | function | Vitest suite every sandbox provider's `IWorkspace` must pass |
| `createGitFixture` | function | A temporary git repository with one commit (branch `main`, tag `v1`) |
| `createFakeGithub` | function | An in-process GitHub (App JWTs, installation tokens, repository routes) for `createGithubApp({ fetch })` |

Types: `ContractWorkspace`, `WorkspaceContractFactory`, `GitFixture`, `FakeGithub`, `FakeGithubOptions`, `FakeRequest`, `FakeRouteInput`, `FakeRouteResult`, `FakeRouteHandler`, `JwtClaims`.

## License

Made with 💚

Published under [Apache License 2.0](./LICENSE).
