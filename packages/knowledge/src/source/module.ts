/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import { documentProblem } from './helpers.ts';
import type {
    IKnowledgeSource,
    KnowledgeDocumentInput,
    KnowledgeSourceContext,
    KnowledgeSourceInput,
} from './types.ts';

/**
 * A custom source (default kind `custom`, trusted). Every document it
 * yields is checked: an invalid one (an id that is not 1 to 255 characters
 * without NUL, content that is no string, metadata that is no plain object)
 * is reported through `ctx.onError` as a ValidationError and skipped. An
 * optional `check()` validates the source's configuration up front (see
 * IKnowledgeSource.check).
 */
export function defineKnowledgeSource(input: KnowledgeSourceInput): IKnowledgeSource {
    if (!isObject(input) || typeof input.documents !== 'function') {
        throw new InvalidAgentDefinitionError('defineKnowledgeSource() needs a documents(ctx) function.');
    }

    if (input.kind !== undefined && (typeof input.kind !== 'string' || input.kind.length === 0)) {
        throw new InvalidAgentDefinitionError('defineKnowledgeSource() kind must be a non-empty string.');
    }

    if (input.trusted !== undefined && typeof input.trusted !== 'boolean') {
        throw new InvalidAgentDefinitionError('defineKnowledgeSource() trusted must be a boolean.');
    }

    if (input.check !== undefined && typeof input.check !== 'function') {
        throw new InvalidAgentDefinitionError('defineKnowledgeSource() check must be a function.');
    }

    const read = input.documents;
    const { check } = input;

    return Object.freeze({
        kind: input.kind ?? 'custom',
        trusted: input.trusted ?? true,
        ...(check && { check: () => check() }),
        async* documents(ctx: KnowledgeSourceContext): AsyncIterable<KnowledgeDocumentInput> {
            for await (const item of read(ctx)) {
                const problem = documentProblem(item);

                if (problem) {
                    ctx.onError(problem);

                    continue;
                }

                yield item;
            }
        },
    });
}
