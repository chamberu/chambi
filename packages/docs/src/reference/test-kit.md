# @chamvi/test-kit

Test helpers for chamvi: a controllable clock, the store and workspace contract suites, a git fixture and an in-process fake GitHub.

```bash
npm install --save-dev @chamvi/test-kit @chamvi/core vitest
```

`@chamvi/core` and `vitest` are peer dependencies; the workspace contract takes any `IWorkspace` of `@chamvi/sandbox`, typed structurally (`ContractWorkspace`), so the kit does not depend on `@chamvi/sandbox`.

## describeStoreContract

```ts
function describeStoreContract(
    create: (clock: ControllableClock) => Stores | Promise<Stores>,
): void;
```

Registers the Vitest suite every `Stores` implementation must pass. `create` is called once per test with a fresh `ControllableClock` and must return a fresh, empty store that uses that clock for every expiry decision.

<<< @/snippets/store-contract.ts#contract

See [Writing a Store](/stores/writing-a-store) for what the suite covers.

## describeWorkspaceContract

```ts
function describeWorkspaceContract(name: string, factory: WorkspaceContractFactory, options?: WorkspaceContractOptions): void;

type WorkspaceContractFactory = (input?: { runId?: string }) => Promise<ContractWorkspace>; // every IWorkspace is a ContractWorkspace
type WorkspaceContractOptions = { find?: (runId: string) => Promise<ContractWorkspace[]> };
```

Registers the Vitest suite every sandbox provider's workspaces must pass: argv exec and exit codes (127 for a command that cannot start), stdin, `cwd` and path escapes (`../..`, `/etc`, an empty path, a NUL byte), the 64 KiB output caps under a flood, a process-group kill on timeout that takes a backgrounded grandchild with it, abort, UTF-8 files and their size cap, and dispose during an exec. `factory` returns a fresh, repo-less workspace per test (of `input.runId` when given); the suite disposes it. With `find` (a second provider instance's `find`, like a restarted process) it also creates a workspace, drops the handle and expects `find` to return it with its files. It runs real processes with short real timeouts, not a `ControllableClock`.

```ts
describeWorkspaceContract('local', () => createLocalSandbox().create({ runId: 'r1' }));
```

## createGitFixture

```ts
function createGitFixture(files: Record<string, string>): Promise<GitFixture>;
```

<<< ../../../test-kit/src/git-fixture/types.ts{ts}

A temporary repository with one commit of `files` on branch `main`, tagged `v1`, ignoring the machine's git config. Pass `url` to a workspace manager with `allowFileRepos: true`.

## createFakeGithub

```ts
function createFakeGithub(options: FakeGithubOptions): FakeGithub;

type FakeGithubOptions = { appId: string; slug?: string; clock: IClock };
```

An in-process GitHub for `createGithubApp({ fetch: fake.fetch, privateKey: fake.privateKey })` from [`@chamvi/github`](/reference/github). It generates an RSA key pair, verifies App JWTs (RS256, `iss`, at most 600 s) on `/app*` and installation tokens (valid one hour on `clock`) on every other route, and answers 404 for unknown routes. Issues, comments, labels, pull requests, contents and releases live in mutable maps (`issues`, `comments`, `labels`, `pulls`, `files`, `releases`, keyed `owner/repo#number` or `owner/repo`); the comment list honours `since` (by `updated_at`) and paginates with a `link` header. Repositories (`repositories`, a missing one synthesized public with default branch `main`), the App's installations (`appInstallations`, `GET /app/installations` with the App JWT), check runs and commit statuses (`checkRuns`, `statuses`, keyed `owner/repo@<sha>`, the combined status state derived) and branch protection and rules (`branches`, `rules`, keyed `owner/repo:<branch>`, unprotected when missing) back the repository, issue and pull request lists, issue and pull request creation (the next number, as the bot; `422` for a second open pull request of one head and base), the merge (`409` when `sha` is not the head, `405` once merged or not mergeable) and `GET /installation/repositories` (the `installations` entries of the token's installation).

| Member | Purpose |
|---|---|
| `fetch` | The fake `fetch` to hand to `createGithubApp` |
| `privateKey`, `publicKey` | The App's key pair (PKCS#1 PEM, `KeyObject`) |
| `requests` | Every request (`method`, `path`, `query`, `body`, `authorization`), in order |
| `jwtClaims`, `tokensIssued`, `tokenInstallations` | The accepted JWTs and the issued installation tokens |
| `route(method, path, handler)` | Adds or overrides a route (`:name` one segment, `*name` the rest) |
| `failNext(method, path, status)` | The next matching request answers `status`, once |

A request whose `signal` aborts, also while a route handler is pending, rejects with the signal's reason, as Node's `fetch` does. It never touches the network.

## ControllableClock

```ts
class ControllableClock implements IClock {
    constructor(start?: Date); // default new Date(0)
    now(): Date;
    setTimeout(fn: () => void, ms: number): { clear(): void };
    advance(ms: number): void;
}
```

Time moves only through `advance(ms)`, which fires every timer due within the window in order, including timers scheduled by fired callbacks. The `keepAlive` timer option has no meaning without a real event loop and is ignored.

<<< @/snippets/testing.ts#clock

Pass the same clock to the store and to the engine (`new Engine({ ..., clock })`) to test claim leases, run timeouts and approval expiry without real timers.
