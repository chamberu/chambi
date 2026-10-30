# Budgets & Timeouts

Every agent has a budget. `defineAgent()` fills in the defaults, and your values are merged over them.

| Field | Default | Kind | Effect |
|---|---|---|---|
| `maxSteps` | `20` | stop condition | Parent agent-loop steps per run, across all executions |
| `maxTokens` | none | stop condition | Parent agent-loop input plus output tokens per run, across all executions |
| `timeoutMs` | `900_000` (15 min) | abort signal | Wall-clock limit **per execution** |

<<< @/snippets/agents.ts#define{25-29}

## How a budget settles a run

| Situation | Status | `error.code` |
|---|---|---|
| The step or token limit is reached and the last step asked for tool calls | `failed` | `BudgetExceeded` |
| The step or token limit is reached and the last step was a final answer | `completed` | |
| The execution ran longer than `timeoutMs` | `failed` | `Timeout` |

The step budget counts checkpointed steps, so a run resumed after a crash or an approval continues with what is left. The token budget adds the usage of earlier executions (`run.usage`) to the current one. These are stop conditions checked after a step, not hard provider-side token ceilings.

Step/token budgets and `run.usage` cover only the parent agent loop. Model calls made inside tools, including `extract()` and direct AI SDK calls using `resolveModel()`, are not included. Nested calls must pass `context.run.signal` to share the execution timeout; `extract()` does this automatically.

The timeout restarts with every execution. A run that waits two days for an approval is not timed out by that wait; only the time spent executing counts, per execution. The timeout aborts the `run.signal` your tools receive, so pass it on to long-running work.

## One step beyond the limit after an approval

A resumed approval gets exactly one step beyond `maxSteps`. An approval asked for on the last allowed step is therefore still answered: the approved call runs (or the denial is recorded) and the model gets one more call to react.

## Token usage

`run.usage` holds `{ inputTokens, outputTokens }` summed over every step of the run. Each `llm` step stores its own usage in `output.usage`. A provider that reports no usage counts as zero.
