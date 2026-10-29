# Errors

Every error chamvi throws extends `ChamviError`, which extends ebec's `BaseError`. Each carries a `code`; the codes are exported as `ErrorCode`.

| Class | `ErrorCode` | Code | Thrown when |
|---|---|---|---|
| `InvalidAgentDefinitionError` | `INVALID_AGENT_DEFINITION` | `invalid_agent_definition` | An agent or channel name, subscription id or cron expression is invalid; duplicate agent or channel names; a subscription to an unknown channel; a tool with `needsApproval` |
| `AgentNotFoundError` | `AGENT_NOT_FOUND` | `agent_not_found` | `dispatch()` for an agent the engine does not hold; `@chamvi/http` answers 404 |
| `InvalidRunStateError` | `INVALID_RUN_STATE` | `invalid_run_state` | A run is not in the status an operation needs: resuming a run that is not waiting, cancelling a settled run, a store guard (`expectStatus`, `expectOwner`) that does not match; `approve()` outside a tool call or in a streaming tool's body; `emit()` outside a tool call |
| `RunNotFoundError` | `RUN_NOT_FOUND` | `run_not_found` | `resume()`, `cancel()`, `repositories.runs.update()` or `repositories.runs.findOneOrFail()` for an unknown run |
| `ArtifactNotFoundError` | `ARTIFACT_NOT_FOUND` | `artifact_not_found` | An execution cannot read an artifact its messages refer to (the run fails); `@chamvi/http` answers 404 with it for an unknown artifact |
| `BudgetExceededError` | `BUDGET_EXCEEDED` | `BudgetExceeded` | A run hit `maxSteps` or `maxTokens` while the model still wanted tools |
| `TimeoutError` | `TIMEOUT` | `Timeout` | An execution exceeded `timeoutMs` |
| `FatalToolError` | `FATAL_TOOL` | `FatalToolError` (or a custom code) | A tool decides the run must fail |
| `IncompleteResponseError` | `INCOMPLETE_RESPONSE` | `incomplete_response` | The model gave no complete answer and the run fails: its stream ended without a finish part, or (with [structured `output`](/guide/agents#structured-output)) the answer was cut off at the output token limit or the loop ended on a tool call nothing executed |
| `ToolNotAllowedError` | `TOOL_NOT_ALLOWED` | `tool_not_allowed` | A call to a tool the agent's `toolPolicy` refuses: recorded on the tool step for a model's call to it, and returned to the model for a pending call that runs after an approval; a tool error, the run goes on |
| `ToolDeniedError` | `TOOL_DENIED` | `tool_denied` | A gate refused a tool call, e.g. a `beforeToolExecution` hook after a denied [approval](/guide/approvals); the message is the gate's, a tool error, the run goes on |
| `ChannelNotFoundError` | `CHANNEL_NOT_FOUND` | `channel_not_found` | `ctx.channels.findOneOrFail()` named a channel the engine does not hold, or one without `out`; an approval delivery through a channel the engine no longer has (to `onError`) |
| `LeaseLostError` | `LEASE_LOST` | `lease_lost` | Reported to `onError` when an engine stops executing a run whose claim it lost; carries `runId` |
| `SandboxError` | `SANDBOX` | `sandbox_error` | A [workspace](/guide/workspaces) or its provider failed: a create, start or checkout (with git's stderr), a missing or oversized file, an unknown, expired or disposed workspace, a Docker or Kubernetes API error, a reached per-run workspace cap; a tool error, the run goes on |
| `ValidationError` | `VALIDATION` | `validation_error` | A state document fails its schema (carries `issues`); an invalid attachment at `dispatch()` or `artifacts.put()`; a final answer that does not parse as the agent's [structured `output`](/guide/agents#structured-output) (the run fails); a workspace path, repository or ref the sandbox rules refuse (a tool error); an `emit()` without an address off the source channel (a tool error) |
| `RepositoryNotFoundError` | `REPOSITORY_NOT_FOUND` | `repository_not_found` | A repository `OrFail` query has no result; single run/artifact lookups use their specific not-found errors |

## Run errors

A failed run stores `{ code, message }` in `run.error`. For budget, timeout and fatal tool failures the code is the error's code. Any other thrown value gets its own `code` if it has a string one, else `Error`.

A run the registry cancelled stores why in `run.error` too, with a code that has no error class (nothing throws it):

| `ErrorCode` | Code | Stored when |
|---|---|---|
| `AGENT_REPLACED` | `agent_replaced` | A folder change (a new revision) or a replaced code agent cancelled the run while it was unsettled |
| `AGENT_REMOVED` | `agent_removed` | The agent was removed (its folder deleted) while the run was unsettled |

A run cancelled on another replica keeps the reason once its owner settles it; a run that completes anyway ends without one. A user's cancel stores no error.

<<< @/snippets/errors.ts#run-error

## Errors without a caller

Some errors happen where nobody awaits: a lost lease, a failed approval message, a listener that throws, a failed recovery pass. They go to `onError(error, run?)`, by default `console.error`. Pass your logger. A `LeaseLostError` there is informational: another replica carries the run on.

<<< @/snippets/errors.ts#on-error
