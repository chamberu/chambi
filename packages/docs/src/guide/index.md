# Overview

This guide describes `@chamvi/core` as it is built today. Every sample on these pages type-checks against the current source.

## The concepts

| Concept | In core | What it is |
|---|---|---|
| **Agent** | `defineAgent()` | A model, instructions, channel subscriptions, tools, hooks, a budget and state |
| **Channel** | `IChannel`, `ctx.channels` | Anything a run comes from or talks to (cron, HTTP, MCP, webhooks, GitHub, OpenClaw, the console). Intake is normalized into a `TriggerEnvelope`; tools send through it |
| **Run** | `Run` | One execution of an agent for one envelope, with a status, usage and output |
| **Step** | `Step` | An `llm`, `tool` or `wait` record, appended as the run progresses |
| **Checkpoint** | `Checkpoint` | The message history after a step; a resumed run continues from the latest one |
| **Tool** | AI SDK `tool()`, `defineTool()`, `defineEffectTool()` | What the model can call. `defineTool()` tools read the run context; effect tools apply at most once per effect key |
| **State** | `AgentState` | Per-agent key-value data and typed collections that outlive runs |
| **Repository** | `Repository` | Runs, steps, checkpoints, keys, locks, effects and state. Pluggable |
| **Workspace** | `@chamvi/sandbox` | A disposable directory or container a run executes commands in, optionally a checkout of a repository. See [Workspaces & Coding](/guide/workspaces) |

The **App** concept (one app with store, channels, HTTP and UI, booted from env) is [`@chamvi/app`](/guide/app).

## The engine in one picture

```
             dispatch(envelope)
                    |
        idempotency key seen? ----yes----> existing run id
                    | no
                    v
               [ queued ] <--------------------------------+
                    | slot free, key free, claim taken     |
                    v                                      |
               [ running ] --- step --> checkpoint         |
                    |                                      |
   +----------------+-----------------+-----------------+  |
   |                |                 |                 |  |
completed         failed          cancelled        waiting -- resume / timeout
                                                    interrupted -- recover
```

See [Run Lifecycle](/guide/run-lifecycle) for every transition.

## Reading order

1. [Agents](/guide/agents) and [Channels & the Envelope](/guide/channels)
2. [Run Lifecycle](/guide/run-lifecycle) and [Execution & Checkpoints](/guide/execution)
3. [Budgets](/guide/budgets), [Tools](/guide/tools), [Effect Tools](/guide/effect-tools), [Approvals & Hooks](/guide/approvals), [State](/guide/state)
4. [Workspaces & Coding](/guide/workspaces) for agents that run commands and edit code
5. [Concurrency](/guide/concurrency), [Cancel, Drain & Recovery](/guide/recovery), [Errors](/guide/errors)
