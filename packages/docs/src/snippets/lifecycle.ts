import type { LanguageModel } from 'ai';
import {
    Engine,
    createMemoryStores,
    defineAgent,
} from '@chamvi/core';

export async function watchRuns(model: LanguageModel) {
    const agent = defineAgent({
        name: 'echo',
        model,
        instructions: 'Repeat the payload.',
    });
    const engine = new Engine({
        stores: createMemoryStores(),
        agents: [agent],
    });

    // #region events
    const offRun = engine.on('run.updated', (event) => {
        if (event.type === 'run.updated') {
            console.log(event.run.id, event.run.status);
        }
    });
    const offStep = engine.on('step.appended', (event) => {
        if (event.type === 'step.appended') {
            console.log(event.step.runId, event.step.index, event.step.kind);
        }
    });
    // #endregion events

    // #region deltas
    const offDelta = engine.on('run.delta', ({ delta }) => {
        // text or reasoning as the model streams it; never stored
        if (delta.kind === 'text') process.stdout.write(delta.text);
    });
    // #endregion deltas

    await engine.start();
    await engine.dispatch({
        agent: 'echo',
        trigger: 'http',
        channel: 'http',
        payload: 'hello',
    });
    await engine.idle();
    await engine.stop();

    offRun();
    offStep();
    offDelta();
}
