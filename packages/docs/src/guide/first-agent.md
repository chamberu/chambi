# Your First Agent

From an empty folder to an agent that runs, reloads when you edit it and is checked in CI. Each step names the rule that trips people up the first time.

## 1. A folder per agent

A project needs three packages and one provider package (an optional peer of `@chamvi/app`, install the one your model uses):

```bash
npm install @chamvi/app @chamvi/cli ai @ai-sdk/anthropic
```

An agent is a folder below `agents/` holding an `agent.ts` that default-exports `defineAgent()`'s result. The folder name is the agent name, and `name` must equal it:

<<< @/snippets/first-agent/agent.ts#agent

No entry file is needed: without `src/index.ts`, `chamvi` runs the default app, `createApp({})` configured by env alone, with its agents from `./agents` (or `CHAMVI_AGENTS_DIR`), and says so on stderr. See [Agent Folders](/guide/agent-folders) for imports, prompts and helpers next to `agent.ts`.

## 2. Something must start a run

An agent without a channel subscription never runs: nothing dispatches it. `channels` decides what starts one:

- `http.on()`: `POST /agents/greeter/runs` with `{ "payload": ... }` and a bearer token holding `agent:greeter:run` (and the MCP tool `run_greeter`). See [HTTP](/guide/http).
- `cron.on('0 9 * * *')`: every day at 09:00 in the process's local zone (or `cron.on(expression, { timezone })`). See [Scheduler](/guide/scheduler).

A subscription to a channel no module contributes (a `github.on()` without `githubModule()`) is a load issue for a folder agent, so the agent is not registered.

## 3. A model

Agents without a `model` take the app's default. One provider, one model, in a `.env` file next to `package.json`:

```bash
# .env
CHAMVI_MODEL=anthropic/claude-sonnet-5-5
ANTHROPIC_API_KEY=sk-ant-...
```

`chamvi dev` reads `.env`; `chamvi start` does not, so in production these come from the process environment (`export` them in a shell, or the deployment's env).

A string names a provider the app declared; nothing falls back to a gateway. See [Pick a Model](/guide/models).

## 4. dev and start

```bash
npx chamvi dev     # .env loaded, restarts on code changes
npx chamvi start   # production: needs CHAMVI_TOKENS
```

`chamvi dev` without `CHAMVI_TOKENS` generates a random token with every permission and logs it once (a warning), so you can call the API right away. `chamvi start` refuses to start without an authenticator: set `CHAMVI_TOKENS` to a JSON list, each `value` at least 16 characters. Generate the value, never copy one from a page:

```bash
export CHAMVI_TOKENS="[{ \"value\": \"$(openssl rand -hex 32)\", \"id\": \"ops\", \"permissions\": [\"*\"] }]"
```

Both listen on port 3000 (`PORT`). Without `DATABASE_URL` runs live in memory: a restart loses them (see [Repositories](/repositories/typeorm) for Postgres).

## 5. The dashboard

The default app has no dashboard. Add an entry that includes `uiModule()` (`npm install @chamvi/ui`):

<<< @/snippets/first-agent/index.ts#dashboard

`chamvi dev` runs `src/index.ts` directly; for `chamvi start`, build it first: `chamvi build` writes `dist/index.mjs` and needs `tsdown` (`npm install --save-dev tsdown`, an optional peer of `@chamvi/cli`). The dashboard is at `/ui`; sign in with a token from `CHAMVI_TOKENS` (or the dev token). See [Dashboard](/guide/ui).

## 6. Editing a folder cancels its runs

`start` watches `agents/`: a changed folder is reloaded within two poll intervals (`CHAMVI_AGENTS_POLL_MS`, 5 s), and every unsettled run of the agent (`queued`, `running`, `waiting`, `interrupted`) is cancelled, once across replicas. Each such run stores `{ code: 'agent_replaced', message }` as its error, and the app logs `agent reloaded` with the cancelled run ids; deleting the folder does the same with `agent_removed`.

Docs and editor leftovers do not count: `README*`, `CHANGELOG*`, `NOTES*`, `LICENSE*`, `*~`, `*.swp`, `*.swo`, `*.bak`, `*.orig`, `.DS_Repository` and dot-files are left out of the folder hash (a `.ts` or `.json` always counts). Settle runs waiting for an approval before you edit an agent, and before you upgrade chamvi. A `run-job` never reloads; see [Jobs never reload](/guide/agent-folders#jobs-never-reload).

## 7. Check it in CI

`chamvi start --check` runs the start path (config, store connection, model settings, every module, every agent folder with its checks) and exits without starting anything or writing to the store:

```bash
npx chamvi build          # only with an entry file (step 5): build exits 2 without one
npx chamvi start --check  # with the production or staging env
```

It needs what a start needs (`CHAMVI_TOKENS`, the provider keys, `DATABASE_URL`). It exits 0 with `chamvi: start check passed`, 2 for a configuration error or an agent folder with a load issue (one per stderr line, never a value), 1 when the store is unreachable or has pending migrations a start would not apply. See [Check before you deploy](/guide/models#check-before-you-deploy).
