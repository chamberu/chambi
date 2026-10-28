# @chamvi/coding

Coding tools for chamvi agents and the coding backend contract. The public API of `packages/coding/src/index.ts`.

```bash
npm install @chamvi/coding @chamvi/sandbox @chamvi/core ai --save
```

`@chamvi/core`, `@chamvi/sandbox` and `ai` are peer dependencies. See [Workspaces & Coding](/guide/workspaces) for the behaviour.

## codingTools

```ts
function codingTools(workspaces: CodingWorkspaces, options?: CodingToolsOptions): ToolSet;

type CodingWorkspaces = Pick<IWorkspaceManager, 'get'>;
```

Throws `InvalidAgentDefinitionError` when `workspaces` has no `get`, `options` is no object or `options.outputLogMaxBytes` is no positive integer. Returns `read_file`, `write_file`, `edit_file`, `multi_edit`, `grep`, `glob`, `list_files`, `bash`, `bash_output`, `bash_kill` and `git_diff`, each a [`defineTool()`](/guide/tools) tool that resolves its workspace through `workspaces.get(context.run.runId, input.workspace)`.

| Tool | Input | Result |
|---|---|---|
| `read_file` | `path`, `offset?` (1-based, default 1), `limit?` (default and maximum 2000), `encoding?` (`utf8` default, `base64`) | `ReadFileResult`; `ReadFileBinaryResult` for `base64` (at most 1 MiB); `ReadFileImageResult` for a png, jpeg, gif or webp (at most 5 MiB), stored as a run artifact (`artifactId`), an image part for the model through `toModelOutput` and `artifactFilePart()`, so steps and checkpoints keep the id only |
| `write_file` | `path`, `content`, `encoding?` (`utf8` default, `base64`) | `WriteFileResult` |
| `edit_file` | `path`, `oldString`, `newString`, `replaceAll?` | `EditFileResult` |
| `multi_edit` | `path`, `edits` (1 to 100 of `{ oldString, newString, replaceAll? }`, applied in order, all or none) | `MultiEditResult` |
| `grep` | `pattern` (ripgrep syntax, else POSIX ERE: see `engine`), `path?`, `ignoreCase?`, `includeIgnored?`, `limit?` (default 100, at most 500) | `GrepResult` |
| `glob` | `pattern` (`*`, `?`, `**/`), `path?`, `includeIgnored?`, `limit?` (default 1000, at most 5000) | `GlobResult` |
| `list_files` | `path?`, `includeIgnored?`, `limit?` (default 1000, at most 5000) | `ListFilesResult` |
| `bash` | `command`, `cwd?` (this call only), `timeoutMs?` (default 300 000, at most 1 800 000), `background?` | `BashResult`; `BashJobResult` with `background: true` |
| `bash_output` | `job`, `offset?` (bytes, default 0) | `BashOutputResult` (at most 32 KiB of output) |
| `bash_kill` | `job` | `BashKillResult` |
| `git_diff` | `staged?`, `path?` | `GitDiffResult` |

`bash` keeps its working directory and exported variables through an `EXIT` trap; a command that sets its own `EXIT` trap replaces it, so that call's state is not kept. `edit_file` and `multi_edit` read the file through `IWorkspace.readFileRaw` when the workspace redacts credentials: they match oldString against the redacted text the model read (`redactedSpans`), refuse an edit that touches a `[redacted]` span and put every untouched token back byte for byte, so an oldString can neither probe a token nor write `[redacted]` back.

Every tool also takes `workspace?`, the id from `create_workspace`. A path is relative to the workspace root or starts with `/workspace/`; `read_file` and `grep` also take the log paths `bash` and `bash_output` name (`~/.chamvi/out/<id>.stdout.log`, `~/.chamvi/jobs/<id>/output`), and nothing else outside the workspace. See [The shell](/guide/workspaces#the-shell) for the kept state, the output logs and the jobs. Input the model can correct (a bad path, an `oldString` that is missing or ambiguous) is a `ValidationError` tool error; a missing or oversized file and any other sandbox failure a `SandboxError` tool error.

<<< ../../../coding/src/tools/types.ts{ts}

```ts
const READ_MAX_LINES: 2_000;
const READ_MAX_CHARS: 65_536;
const SEARCH_MAX_RESULTS: 500;
const LIST_MAX_RESULTS: 5_000;
const LINE_MAX_CHARS: 500;
const OUTPUT_LOG_MAX_BYTES: 67_108_864; // 64 MiB, the default outputLogMaxBytes
```

## Repository instructions

`CodingToolsOptions.repositoryInstructions` defaults to `true`. Ordinary UTF-8 workspace `read_file` results add the optional `ReadFileResult.instructions?: RepositoryInstructions` field. Each read collects guidance for the file's root and ancestors, including include expansion, scopes, hashes, parents, diagnostics and `complete`; the [sandbox collector](/reference/sandbox#repository-instructions) defines ordering, bounds and failure behavior. An incomplete collection is still visible with `complete: false`; an inspection/transport error fails the tool instead of delivering an empty context. Resolve missing guidance that could change the task before proceeding.

`codingTools(workspaces, { repositoryInstructions: false })` omits the field. Binary/base64 reads, image reads and HOME log reads always omit it. The coding option is independent of `createWorkspaceManager({ repositoryInstructions: false })`: the manager's flag controls root collection on create and the presence of `read_repository_instructions`, while coding's flag controls text-read attachments. Both default on; set both off to disable both forms of context delivery. Neither restricts filesystem access.

There is no cross-call cache: new reads reflect current worktree instructions, while previous tool results remain in steps and checkpoints through pauses and restarts. Before direct edits or shell work in a new subtree, request its context through `read_file` or the manager's `read_repository_instructions` tool. Repository guidance or a system prompt grants no operator authorization, permissions, credentials, skill installation or publication rights. `write_file`, `edit_file`, `multi_edit` and arbitrary `bash` do not enforce instruction scope, and bash bypasses file-tool-only enforcement. Discovery's observed symlink, special-file, `.git` and escape refusal is best-effort; race-free confinement remains [#92](https://github.com/chamvi/chamvi/issues/92).

## ICodingBackend

The contract for something that solves a coding task in a workspace with its own tool loop. Only the contract ships; backends (the own tools in a nested loop, Claude Code) are planned.

<<< ../../../coding/src/backend/types.ts{ts}
