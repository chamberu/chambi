# Reference: eve

- **Project:** [vercel/eve](https://github.com/vercel/eve), Vercel's open-source agent framework (TypeScript, Apache-2.0). Package `eve` plus `@eve/code`, `@eve/git`, `@eve/self-modification` and the tracing library `@vercel/agent-runs` (`packages/tracing`).
- **Docs:** https://eve.dev/
- **Why referenced:** the closest competitor (durable agents with approvals, sandboxes, schedules, GitHub), and a source of patterns for tracing, evals, approvals, coding tools, sandbox resume and context compaction. Reasoning and the plans that came out of it: `.agents/plans/021` to `024`, notes in 009, 013, 014, 019, 020.
- **Verified against:** `eve` 0.81.1, commit `c543585` (2026-10-20), source read only. Paths are relative to `packages/eve/src` unless they start with `packages/`, `docs/` or `research/`.
- **How to maintain:** when you look something up in eve, add or correct the row here and pin the version or date.

## Architecture in one paragraph

eve is a compiled, filesystem-first framework: an `agent/` folder (`agent.ts`, `instructions.md`, `tools/`, `subagents/`, `skills/`, `connections/`, `schedules/`, channels) is discovered and compiled by `eve build` into a Nitro server plus a Workflow DevKit bundle (`compiler/compile-agent.ts`, `internal/workflow-bundle/`). There is no supported programmatic agent API (research/programmatic-agent-sources.md). Durability is `@workflow/core` 5.x: `"use workflow"` orchestrators are replayed deterministically, `"use step"` results are memoized; a session is one long-lived workflow run (`execution/session/entry.ts:68-80`), one step one model call plus its tool calls (`execution/session/turn-step.ts:109-118`), each a fresh `ToolLoopAgent` with `stopWhen: isStepCount(1)` (`harness/model-call/call.ts:383`). State lives in the Workflow "World" (local files, `@workflow/world-postgres`, Vercel).

## Concept map (eve -> chamvi)

| eve | chamvi | Differences / notes |
|---|---|---|
| Agent folder compiled by `eve build`, `defineDynamic` for runtime changes | `defineAgent()` object, `Engine` composed in code | chamvi is a library; eve cannot be embedded in another Node app. |
| Session = one workflow run, turns inside (`execution/session/program.ts:93`) | Run per trigger, `thread` for continuation | eve is conversation-centric (channels), chamvi trigger-centric. |
| Durable step: Workflow `"use step"` memo + replay; checkpoint `DurableSessionState` (`execution/durable-session-store.ts:24-71`) | Step rows + latest checkpoint in `ICheckpointRepository`, leases, `recover()` | eve replays code: after an upgrade, sessions on non-Vercel worlds are "stranded" and must be reset (docs/concepts/execution-model-and-durability.mdx:46-80). chamvi's checkpoints are data only. |
| Interrupted step re-runs; tools must be idempotent | `defineEffectTool`, `alreadyApplied`, `effectMarker` | eve has no exactly-once effect mechanism. |
| Delivery idempotency window, 1024 keys per session (`channel/delivery-idempotency.ts:2`) | `IIdempotencyRepository.claim` per `(scope, key)`, TTL 7 days | eve's window is not exactly-once (research/channel-delivery-idempotency.md). |
| `experimental.workflow.modelCallsPerStep` (`execution/model-call-batching.ts`) | One checkpoint per model step | Possible opt-in knob for chamvi. |
| Approval: `approval: never/once/always/auto()/fn` (`tools/approval/policies.ts:86-125`), request + response policy (`approval/definition.ts:64-140`) | `await approve(ctx, { title, timeoutMs? })` inside a tool or a `beforeToolExecution` hook (durable suspend and replay), `agent:<name>:approve`, answered by run and approval id (`engine.approve()`) | eve resumes by request id + channel auth, holds never time out; chamvi answers by run and approval id (authenticated) and has a per-request `timeoutMs`. eve's response policy (who may answer) has no chamvi counterpart yet (plan 023). |
| `auto()` approval: decision model on tool name + input, 30 s, fails to human (`tools/approval/policies.ts:27-63`) | none | Plan 023. |
| `capabilities.requestInput = false` for sessions nobody can answer (`channel/types.ts:418-429`) | none (a cron run waits in the inbox, or on the channel a tool asked through) | Plan 023. |
| Channels: `defineChannel` (`public/definitions/channel.ts:300`), Slack/Teams/Discord/Telegram/Linear/Twilio/GitHub, Chat SDK bridge (`public/channels/chat-sdk/chatSdkChannel.ts:302`) | `IChannel` (`in`/`out`/`start`, plan 026): cron, http, mcp, webhook, github, openclaw, console | A chat channel (#32) may take the Chat SDK (`chat`). |
| Slack approval cards (`public/channels/slack/approval-cards.ts:44-80`) | none | Plan 009. |
| GitHub channel: HMAC verify (`public/channels/github/verify.ts:44-83`), self-loop guard by marker, `type === 'Bot'`, `<bot>[bot]` (`public/channels/github/inbound.ts:513-523`) | `githubChannel()` `in` (at `/channels/github`), `botLogin()` guard | eve does not use `X-GitHub-Delivery` as dedupe key (`public/channels/github/dispatch.ts:341`); chamvi does. |
| Schedules: `defineSchedule` (`public/definitions/schedule.ts:93`), Nitro tasks or Vercel Cron | `cron.on()` + `cronChannel()` of `@chamvi/channel-cron` (hubwire, store locks, overlap policy) | eve has no overlap or lock handling; self-hosted it must run on one replica. |
| Route auth: ordered `AuthFn` walk, fail closed (`public/channels/auth.ts`) | `Authenticator` chain in `@chamvi/http` | Equivalent. |
| Connections: `defineMcpClientConnection`, `defineOpenAPIConnection`, interactive auth `getToken`/`startAuthorization`/`completeAuthorization` (`shared/connection-types.ts:333,428`) | none (only `@chamvi/github` tools) | Candidate for a later plan. |
| Memory: `defineMemory`, provider `recall`/`capture`/`tools` (`public/memory/index.ts:132-170`), CAS document backend (`public/memory/file/backend.ts:30-45`) | `IAgentState` KV + typed collections | Template for 013. |
| Sandbox provider `prepare`/`start`/`resume(state)`/`onSessionEnd` + `stateProtocolVersion` (`shared/sandbox-provider.ts:131-158`, `execution/sandbox/ensure.ts`) | `ISandboxProvider.create`, workspace manager per process | Plan 020. |
| `SandboxSession` = `Pick<Experimental_SandboxSession>` from `ai` (`shared/sandbox-session.ts:92-117`) | `IWorkspace` | AI SDK v7 `ToolLoopAgent` accepts `experimental_sandbox`; an adapter is possible. |
| Docker container name `eve-sbx-<hash>` (`execution/sandbox/bindings/docker.ts:349-361`) | `chamvi-ws-<uuid>` | Deterministic name enables resume (020). |
| Network policy with header injection at the firewall (`shared/sandbox-network-policy.ts`) | none (NetworkPolicy planned in 011) | |
| `bash`: 30 s then background job under `/tmp/.eve/jobs/<id>/` (`execution/sandbox/bash.ts`) | `bash` with timeout | Plan 019. |
| `write_file`: refuses unread or stale files (`execution/sandbox/write-file.ts:77-103`) | `write_file` writes unconditionally | Plan 019. |
| Truncation 2000 lines / 50 KiB / 2000 chars per line (`execution/sandbox/truncate-output.ts:15-25`) | `OUTPUT_MAX_BYTES` 64 KiB, `READ_MAX_LINES`, `LINE_MAX_CHARS` | |
| `apply_patch` with introduced-only diagnostics (`packages/eve-code/extension/tools/apply_patch.ts`) | `edit_file` (oldString/newString) | Plan 019. |
| `@eve/git` credential leases: placeholder token, header rewrite at egress (`packages/eve-git/lib/github-shell.ts:209-264`) | scoped token deferred | Plan 014. |
| Subagents as tasks: tool `{ message, taskId? }`, child is its own session, HITL relayed (`subagents/adapter.ts`, `hitl-proxy.ts`, research/eve-tasks.md) | none | Later. |
| Compaction: trim old tool results, then LLM checkpoint summary at 0.9 of the window (`harness/compaction/engine.ts`) | none | Plan 024. |
| Prompt cache breakpoints (`harness/prompt-cache.ts`) | none | Plan 024. |
| Deferred tools `eve__search`/`eve__tool` (research/deferred-tools.md, `execution/catalog/`) | `toolPolicy` / `activeTools` | Plan 024. |
| Evals: `defineEval({ test(t) })`, assertions, `.gate/.soft`, verdicts, tool stubs, reporters, `eve eval` (`evals/`, `tool-stubs/`, `cli/eval.ts`) | none (spec v1 non-goal) | Plan 022 (proposal). |
| `@vercel/agent-runs`: `createAgentRun`, `aiSdkTelemetry`, `gen_ai.*` spans, `TraceCheckpointer` (`packages/tracing/src/`) | engine events only | Plan 021. Peer `@opentelemetry/api` only; 0.0.1, `engines: node >=24`. |
| SSE stream lease: heartbeat, lease-end record, reconnect from cursor (research/leased-session-stream-responses.md) | SSE with `Last-Event-ID`, ping on the poll interval | |
| Skills: `SKILL.md`, name + description in prompt, body via `eve__skill` | none | Later. |
