/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import { defineEffectTool } from '../effect/define.ts';
import { defineTool } from '../tool/define.ts';
import { docJsonSchema, perCallKey } from './helpers.ts';
import type { StateSchema } from './types.ts';

/**
 * Tools exposing the agent's state collections to the model:
 * `state_<coll>_list`, `state_<coll>_upsert` and `state_<coll>_remove`
 * (the latter two are effect tools). Upsert validates via the state API, so an
 * invalid document becomes a tool error the model can correct. Every tool is
 * a chamvi tool and reads the state from its context (`context.state`).
 */
export function createStateTools<S extends StateSchema>(schema: S): ToolSet {
    const tools: ToolSet = {};

    for (const coll of Object.keys(schema) as Array<keyof S & string>) {
        const doc = docJsonSchema(schema[coll] as StateSchema[string]);

        tools[`state_${coll}_list`] = defineTool({
            description: `List documents of the "${coll}" state collection, optionally filtered by top-level field equality.`,
            inputSchema: jsonSchema<{ where?: Record<string, unknown>; limit?: number }>({
                type: 'object',
                properties: {
                    where: { type: 'object', description: 'Top-level fields that must equal the given values.' },
                    limit: { type: 'integer', minimum: 1 },
                },
                additionalProperties: false,
            }),
            execute: async (input, { context }) => context.state.collection(coll).list({ where: input.where as never, limit: input.limit }),
        });

        tools[`state_${coll}_upsert`] = defineEffectTool({
            effectKey: perCallKey(`state_${coll}_upsert`),
            description: `Create or replace the document with this id in the "${coll}" state collection.`,
            inputSchema: jsonSchema<{ id: string; doc: unknown }>({
                type: 'object',
                properties: { id: { type: 'string' }, doc },
                required: ['id', 'doc'],
                additionalProperties: false,
            }),
            execute: async (input, { context }) => {
                await context.state.collection(coll).upsert(input.id, input.doc as never);

                return { ok: true, id: input.id };
            },
        });

        tools[`state_${coll}_remove`] = defineEffectTool({
            effectKey: perCallKey(`state_${coll}_remove`),
            description: `Remove the document with this id from the "${coll}" state collection.`,
            inputSchema: jsonSchema<{ id: string }>({
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false,
            }),
            execute: async (input, { context }) => {
                await context.state.collection(coll).remove(input.id);

                return { ok: true, id: input.id };
            },
        });
    }

    return tools;
}
