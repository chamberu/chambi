/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { toLanguageModel } from '../../../src/model/asserts.ts';

describe('toLanguageModel', () => {
    it('refuses a missing ref', () => {
        expect(() => toLanguageModel(undefined, undefined, 'ops')).toThrow(InvalidAgentDefinitionError);
        expect(() => toLanguageModel(undefined, undefined, 'ops'))
            .toThrow('Agent "ops" has no model and the app sets no default (CHAMVI_MODEL).');
    });

    it('refuses a string without a resolver', () => {
        expect(() => toLanguageModel('openai/gpt-5', undefined, 'ops')).toThrow(InvalidAgentDefinitionError);
        expect(() => toLanguageModel('openai/gpt-5', undefined, 'ops')).toThrow(
            'Agent "ops" uses the model string "openai/gpt-5", but the engine has no model resolver (EngineOptions.models); pass a LanguageModel object.',
        );
    });

    it('wraps a non-Error throw of resolve()', () => {
        const models = {
            check: () => {},
            resolve: () => {
                // eslint-disable-next-line no-throw-literal
                throw 'nope';
            },
        };
        expect(() => toLanguageModel('a/b', models, 'ops')).toThrow('Model "a/b" could not be resolved: nope');
    });
});
