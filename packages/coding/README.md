<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/coding" width="128" height="128" />
</p>

<h1 align="center">@chamvi/coding</h1>

<p align="center">
    <b>Coding tools for chamvi agents.</b><br>
    Read, write and edit files, search, run shell commands and show the diff,<br>
    in a disposable workspace of the calling run on any sandbox provider.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/coding"><img src="https://img.shields.io/npm/v/@chamvi/coding" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/coding/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/coding" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [Tools](#tools)
- [Workspaces](#workspaces)
- [Not effect tools](#not-effect-tools)
- [Security](#security)
- [Coding backends](#coding-backends)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/coding @chamvi/sandbox @chamvi/core ai --save
```

ESM only, Node.js `>=22`. `@chamvi/core`, `@chamvi/sandbox` and `ai` are peer dependencies. Add a sandbox provider: `@chamvi/sandbox-docker` or `@chamvi/sandbox-k8s` (or `@chamvi/sandbox-local` for development).

## Usage

```typescript
import type { LanguageModel } from 'ai';
import { codingTools } from '@chamvi/coding';
import { ToolDeniedError, approve, defineAgent } from '@chamvi/core';
import type { IWorkspaceManager } from '@chamvi/sandbox';

export function createCodingAgent(model: LanguageModel, workspaces: IWorkspaceManager) {
    return defineAgent({
        name: 'triage',
        model,
        instructions: 'Check out the repository named in the payload, reproduce the reported bug ' +
            'with a failing test and answer with what you found and the diff.',
        // create_workspace and dispose_workspace, then the coding tools
        tools: { ...workspaces.tools(), ...codingTools(workspaces) },
        hooks: {
            // every shell command waits for a human
            async beforeToolExecution({ toolName, input }, ctx) {
                if (toolName !== 'bash') return input;
                const { command } = input as { command: string };
                const decision = await approve(ctx, { title: 'Run a shell command?', body: command });
                if (!decision.approved) throw new ToolDeniedError(`Command refused: ${decision.reason ?? 'denied'}`);
                return input;
            },
        },
        budget: { maxSteps: 40 },
    });
}
```

`workspaces` is a manager from `createWorkspaceManager({ provider })` (`@chamvi/sandbox`), attached to the engine with `workspaces.attach(engine)` so a run's workspaces go when it settles. The model calls `create_workspace` first, then works in it. Subscribe the agent to a channel to start it (`channels: [http.on()]` with `@chamvi/http`).

The tools are plain tools you did not write, so the gate lives in the agent's `beforeToolExecution` hook: it runs before every tool call, and `approve()` there pauses the run in `waiting` until someone answers (the UI inbox, `POST /runs/:id/approve`, or a channel's approval message with `ctx.channels.findOneOrFail(name).approve(...)`). The run keeps its workspace while it waits on this replica. Once answered, the hook runs again and `approve()` returns the decision; a thrown `ToolDeniedError` goes back to the model as a tool error and the run goes on.

## Tools

`codingTools(workspaces, { outputLogMaxBytes? })` returns a plain AI SDK `ToolSet`. Paths are relative to the workspace root or start with `/workspace/`; anything that leaves the root is a tool error.

| Tool | Input | Result |
|---|---|---|
| `read_file` | `{ path, offset?, limit?, encoding?, workspace? }` | `{ path, content, startLine, endLine, totalLines, truncated }`: at most 2000 lines and 65 536 characters of a text file up to 16 MiB; `{ path, encoding: 'base64', content, bytes }` with `encoding: 'base64'` (at most 1 MiB); `{ path, type: 'image', mediaType, bytes, artifactId }` for a png, jpeg, gif or webp up to 5 MiB, stored as a run artifact, which the model gets as an image (steps and checkpoints keep the id only). Also reads the output logs of `bash` |
| `write_file` | `{ path, content, encoding?, workspace? }` | `{ path, bytes }`: replaces the file (text, or bytes with `encoding: 'base64'`), creates missing directories |
| `edit_file` | `{ path, oldString, newString, replaceAll?, workspace? }` | `{ path, replacements }`: `oldString` must match exactly once unless `replaceAll`. Calls of `edit_file` and `write_file` on one file run one after the other, so several edits of a file in one step all apply |
| `multi_edit` | `{ path, edits: [{ oldString, newString, replaceAll? }], workspace? }` | `{ path, edits, replacements }`: the edits in order on the file's content, nothing written when one fails |
| `grep` | `{ pattern, path?, ignoreCase?, includeIgnored?, limit?, workspace? }` | `{ matches: [{ path, line, text }], truncated, engine }`: ripgrep when the image has it, else `git grep -E`, else `grep -rE` (one `grep` per file for BusyBox); tracked, untracked and hidden files, git-ignored ones with `includeIgnored`; default 100, at most 500 matches, lines cut at 500 characters |
| `glob` | `{ pattern, path?, includeIgnored?, limit?, workspace? }` | `{ files, truncated }`: files matching a `**` pattern, sorted |
| `list_files` | `{ path?, includeIgnored?, limit?, workspace? }` | `{ files, truncated }`: tracked and untracked, git-ignored ones with `includeIgnored`, sorted; default 1000, at most 5000 |
| `bash` | `{ command, cwd?, timeoutMs?, background?, workspace? }` | `{ exitCode, stdout, stderr, stdoutTruncated, stderrTruncated, stdoutBytes, stderrBytes, stdoutLog, stderrLog, cwd, outputCapped, timedOut, durationMs }`: a shell (bash when present) that keeps its working directory and exported variables between calls; the whole output in `~/.chamvi/out/` (at most `outputLogMaxBytes` per stream, 64 MiB by default: past it the call is killed, `outputCapped: true`), the result showing the first 8 KiB and the last 24 KiB of a longer stream; default timeout 5 minutes, at most 30. With `background: true` `{ job, status: 'running', outputLog }` at once |
| `bash_output` | `{ job, offset?, workspace? }` | `{ job, status, exitCode?, output, offset, nextOffset, size, truncated, outputCapped }`: a background job's output from a byte offset (at most 32 KiB) and its status (`running`, `exited`, `killed`, `lost`); a job whose output passes `outputLogMaxBytes` is killed (`outputCapped: true`) |
| `bash_kill` | `{ job, workspace? }` | `{ job, status, exitCode? }`: stops the job and every process it started |
| `git_diff` | `{ staged?, path?, workspace? }` | `{ status, diff, truncated }`: `git status --short` and the unified diff (of the index with `staged`) |

`git_diff`, `list_files` and `grep` (with git grep) read paths literally, so a path like `:!src` names a file and is never pathspec magic. A model mistake (an unknown file, an `oldString` that is missing or ambiguous, a bad path) comes back as a tool error it can correct; a broken sandbox is a `SandboxError` tool error, never a failed run.

## Workspaces

Every tool takes an optional `workspace` id (from `create_workspace`). Omitted, the tool uses the run's only workspace; with several, the model must name one. Workspaces are resolved through the manager with `context.run.runId`, so a run can never reach another run's workspace: an id of another run is "not found".

## Not effect tools

`write_file`, `edit_file`, `multi_edit` and `bash` change state but are deliberately not effect tools. A workspace lives in one process and dies with it, while an effect record survives in the store: after a crash the redone step runs on a fresh workspace, where a recorded "applied" result would skip the write. Re-applying is safe instead: `write_file` is idempotent, `edit_file` fails with "oldString not found" when it already applied, and `bash` runs in a disposable sandbox. Nothing outside the workspace changes (no push).

## Security

`bash` runs whatever the model writes, and the model follows what it reads (an issue, a README, a test output): treat it as untrusted code. Use the Docker or Kubernetes provider, keep the workspace network firewalled, narrow `allowRepo` on the manager, and put `bash` behind an approval (a `beforeToolExecution` hook calling `approve()`, as in [Usage](#usage)) where a human should see each command.

## Coding backends

`ICodingBackend` is the contract for something that solves a coding task in a workspace with its own tool loop (Claude Code, or these tools in a nested agent):

```ts
interface ICodingBackend {
    code(task: CodingTask): Promise<CodingResult>;
}
// CodingTask: { workspace, task, budget?: { maxSteps?, maxTokens?, timeoutMs? }, signal? }
// CodingResult: { status: 'done' | 'stuck', summary, diff }
```

The package ships the contract only; backends are planned.

## API

| Export | Kind | Purpose |
|---|---|---|
| `codingTools` | function | The coding tools over a workspace manager |
| `READ_MAX_LINES`, `READ_MAX_CHARS` | constant | `2_000`, `65_536` |
| `SEARCH_MAX_RESULTS`, `LIST_MAX_RESULTS` | constant | `500`, `5_000` |
| `LINE_MAX_CHARS` | constant | `500` |
| `OUTPUT_LOG_MAX_BYTES` | constant | `64 * 1_048_576` (64 MiB), the default `outputLogMaxBytes` of `codingTools()` |

Types: `CodingWorkspaces`, `CodingToolsOptions`, `ReadFileResult`, `ReadFileBinaryResult`, `ReadFileImageResult`, `WriteFileResult`, `EditFileResult`, `MultiEditResult`, `GrepEngine`, `GrepMatch`, `GrepResult`, `GlobResult`, `ListFilesResult`, `BashResult`, `BashJobResult`, `BashJobStatus`, `BashOutputResult`, `BashKillResult`, `GitDiffResult`, `ICodingBackend`, `CodingTask`, `CodingResult`, `CodingBudget`.

## License

Published under [Apache License 2.0](./LICENSE).
