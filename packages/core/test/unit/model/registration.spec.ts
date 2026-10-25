/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import type { LanguageModel } from 'ai';
import {
    Engine,
    InvalidAgentDefinitionError,
    checkAgentModel,
    defineAgent,
} from '@chamvi/core';
import type {
    Agent,
    AgentChange,
    EngineOptions,
    IModelResolver,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import { MemoryStore } from '../../../src/store/index.ts';

const NO_MODEL = 'Agent "triage" has no model and the app sets no default (CHAMVI_MODEL).';
const SHAPE = 'Agent "triage": model must be a "<provider>/<model>" string or a LanguageModel object.';
const DEFAULT_SHAPE = 'The default model must be a "<provider>/<model>" string or a LanguageModel object.';

/** Records every check; refuses the refs in `refused`. */
function recordingResolver(refused: string[] = []): IModelResolver & { checks: Array<[string, string | undefined]> } {
    const checks: Array<[string, string | undefined]> = [];
    return {
        checks,
        check(ref: string, agent?: string) {
            checks.push([ref, agent]);
            if (refused.includes(ref)) throw new InvalidAgentDefinitionError(`Model "${ref}" is refused.`);
        },
        resolve() {
            throw new Error('resolve() must not run at registration');
        },
    };
}

/** An agent whose definition carries any model value, as a folder agent's agent.ts may export. */
function withModel(model: unknown, name = 'triage'): Agent {
    const agent = defineAgent({ name, instructions: 'x' });
    return { ...agent, definition: { ...agent.definition, model: model as LanguageModel } };
}

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

function make(opts: Partial<EngineOptions> = {}) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = new MemoryStore({ clock });
    const engine = new Engine({
        store,
        clock,
        agents: [],
        onError: () => {},
        ...opts,
    });
    engines.push(engine);
    return {
        store, 
        clock, 
        engine, 
    };
}

describe('model registration', () => {
    it('refuses an agent without model and default', async () => {
        const agent = defineAgent({ name: 'triage', instructions: 'x' });
        expect(() => make({ agents: [agent] })).toThrow(InvalidAgentDefinitionError);
        expect(() => make({ agents: [agent] })).toThrow(NO_MODEL);

        const { engine } = make();
        await expect(engine.putAgent(agent)).rejects.toThrow(NO_MODEL);
        expect(engine.getAgent('triage')).toBeUndefined();
    });

    it('an agent without model inherits the default', async () => {
        const agent = defineAgent({ name: 'triage', instructions: 'x' });
        const { engine } = make({ agents: [agent], model: mockModel([]) });
        expect(engine.getAgent('triage')).toBe(agent);

        const models = recordingResolver();
        const other = make({ model: 'team-a/default', models });
        await expect(other.engine.putAgent(agent)).resolves.toBe('added');
        // the default is checked once at construction, then as the agent's ref
        expect(models.checks).toEqual([['team-a/default', undefined], ['team-a/default', 'triage']]);
    });

    it('checks string refs', async () => {
        const models = recordingResolver();
        make({ agents: [withModel('team-a/m')], models });
        expect(models.checks).toEqual([['team-a/m', 'triage']]);

        const defaults = recordingResolver();
        make({
            agents: [], 
            model: 'team-b/d', 
            models: defaults, 
        });
        expect(defaults.checks).toEqual([['team-b/d', undefined]]);

        const refused = recordingResolver(['team-a/m']);
        expect(() => make({ agents: [withModel('team-a/m')], models: refused })).toThrow('Model "team-a/m" is refused.');

        const refusedDefault = recordingResolver(['team-b/d']);
        expect(() => make({ model: 'team-b/d', models: refusedDefault })).toThrow('Model "team-b/d" is refused.');

        const put = recordingResolver();
        const { engine } = make({ models: put });
        await engine.putAgent(withModel('team-c/x'));
        expect(put.checks).toEqual([['team-c/x', 'triage']]);
    });

    it('a refusal in putAgent writes nothing', async () => {
        const models = recordingResolver(['bad/model']);
        const { engine, store } = make({ agents: [withModel('good/model')], models });
        const changes: AgentChange[] = [];
        engine.on('agents.changed', (e) => {
            changes.push(e);
        });
        const { runId } = await engine.dispatch({
            agent: 'triage',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });

        await expect(engine.putAgent(withModel('bad/model'), { revision: 'h1' })).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(engine.putAgent(withModel(undefined))).rejects.toThrow(NO_MODEL);

        expect(await store.listAgentRevisions()).toEqual([]);
        expect((await store.getRun(runId))?.status).toBe('queued');
        expect(changes).toEqual([]);
        expect(engine.getAgent('triage')?.definition.model).toBe('good/model');
    });

    it('object refs are never checked', async () => {
        const models = recordingResolver();
        const { engine } = make({
            agents: [withModel(mockModel([]))], 
            model: mockModel([]), 
            models, 
        });
        await engine.putAgent(withModel(mockModel([]), 'digest'));
        expect(models.checks).toEqual([]);
    });

    it('a model that is neither a non-empty string nor an object is refused', async () => {
        for (const value of ['', 42, true, []]) {
            expect(() => make({ agents: [withModel(value)], model: mockModel([]) })).toThrow(SHAPE);
        }
        // null reads as no model: the default applies, else it is refused
        expect(() => make({ agents: [withModel(null)], model: mockModel([]) })).not.toThrow();
        expect(() => make({ agents: [withModel(null)] })).toThrow(NO_MODEL);
        const { engine } = make({ model: mockModel([]) });
        await expect(engine.putAgent(withModel(''))).rejects.toThrow(SHAPE);

        for (const value of ['', 42, []]) {
            expect(() => make({ model: value as LanguageModel })).toThrow(DEFAULT_SHAPE);
        }
    });

    it('without models strings pass', async () => {
        const { engine } = make({ agents: [withModel('anthropic/claude')] });
        expect(engine.getAgent('triage')).toBeDefined();
        await expect(engine.putAgent(withModel('any/thing', 'digest'))).resolves.toBe('added');
        expect(() => make({ model: 'any/default' })).not.toThrow();
    });

    it('checkAgentModel applies the same rules', () => {
        const models = recordingResolver();
        expect(() => checkAgentModel(withModel(undefined), {})).toThrow(NO_MODEL);
        expect(() => checkAgentModel(withModel(7), {})).toThrow(SHAPE);
        checkAgentModel(withModel(undefined), { model: 'team-a/d', models });
        checkAgentModel(withModel('team-a/m'), { models });
        expect(models.checks).toEqual([['team-a/d', 'triage'], ['team-a/m', 'triage']]);
    });
});
