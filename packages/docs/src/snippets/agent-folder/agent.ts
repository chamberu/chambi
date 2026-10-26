// #region agent
// agents/triage/agent.ts: the one file chamvi reads; the name must match the folder name
import { readFileSync } from 'node:fs';
import { defineAgent, http } from '@chamvi/app';
import { lookupIssue } from './tools/lookup-issue.ts';

export default defineAgent({
    name: 'triage',
    // no model: the app's default (CHAMVI_MODEL or createApp({ model }))
    // read on every load, so an edit of prompt.md reloads the agent like any other file
    instructions: readFileSync(new URL('./prompt.md', import.meta.url), 'utf8'),
    tools: { lookup_issue: lookupIssue },
    channels: [http.on()],
    budget: { maxSteps: 10 },
});
// #endregion agent
