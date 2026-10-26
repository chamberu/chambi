// #region agent
// agents/greeter/agent.ts: the folder name is the agent name
import { cron, defineAgent, http } from '@chamvi/app';

export default defineAgent({
    name: 'greeter',
    // no model: the app's default (CHAMVI_MODEL)
    instructions: 'Greet whoever sent the payload, in one sentence.',
    // what starts a run: POST /agents/greeter/runs, and every day at 09:00
    channels: [http.on(), cron.on('0 9 * * *')],
});
// #endregion agent
