# Quick Start

One agent, an in-memory store, the console channel and one manually dispatched run that answers where it came from. This is the same code as the example in the `@chamvi/core` README, which the test suite runs against a scripted model.

<<< @/snippets/quick-start.ts

Pass any AI SDK `LanguageModel`, for example `anthropic(...)` from `@ai-sdk/anthropic`. The function resolves with the settled run and the labels the tool added; the console channel logged `Labelled as bug.` once.

## What happened

1. **`defineAgent()`** checked the name and filled in the default budget. The `tools` factory runs once per execution and returns an AI SDK `ToolSet`.
2. **`new Engine()`** validated the setup: unique agent and channel names, subscriptions to known channels.
3. **`engine.start()`** recovered abandoned runs (there were none), started the channels and started polling.
4. **`engine.dispatch()`** stored a `queued` run. The envelope (channel, subscription id and payload) became the run's first user message; `address` is where the run came from on that channel.
5. The engine claimed the run, set it `running` and drove an AI SDK `ToolLoopAgent`. After every step it appended the steps and saved a checkpoint to the store.
6. The model called `addLabel`. Because it is an [effect tool](/guide/effect-tools), its result was recorded under an effect key, so a resumed run would reuse it instead of labelling twice. Inside it, [`context.channels.findOne()`](/guide/channels#outbound-from-tools) answered on the run's channel and address; that emit is recorded too, so it is sent once.
7. The model answered with text, and the run settled `completed`. Its `output` is the text of the last answer (an agent with [structured output](/guide/agents#structured-output) gets the parsed value instead).
8. **`engine.idle()`** resolved once nothing was running, and **`await engine.stop()`** stopped the poll and the channels.

## Where to go next

- [Your First Agent](/guide/first-agent): the same agent as a folder on `@chamvi/app`, run with `chamvi dev`, checked with `chamvi start --check`
- Replace `createMemoryRepositories()` with a durable store before you rely on restarts. See [Repositories](/repositories/).
- Add a [budget](/guide/budgets), [approvals](/guide/approvals) or [state](/guide/state).
- Shut down with [`drain()`](/guide/recovery) instead of `stop()` in a real process.
