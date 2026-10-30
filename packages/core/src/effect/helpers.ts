/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { buildIssuesForStandardSchemaIssues } from '@validup/standard-schema';
import { TypeValidationError, asSchema } from 'ai';
import type { FlexibleSchema } from 'ai';
import { isObject } from 'smob';
import { ValidationError } from '../errors/index.ts';
import { describeIssues } from '../state/helpers.ts';

function canonical(value: unknown): unknown {
    if (isObject(value) && typeof value.toJSON === 'function') {
        return canonical(value.toJSON());
    }

    if (Array.isArray(value)) {
        return value.map((v) => canonical(v));
    }

    if (isObject(value)) {
        const out: Record<string, unknown> = {};

        for (const key of Object.keys(value).sort()) {
            out[key] = canonical(value[key]);
        }

        return out;
    }

    return value;
}

/**
 * sha256 hex of the canonical JSON (recursively sorted keys; undefined dropped;
 * toJSON values such as Date are serialized via toJSON). BigInt and cyclic
 * inputs are unsupported and throw.
 */
export function stableHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
}

/**
 * `input` parsed by the tool's input schema (the parsed value, so a schema's
 * transforms apply); a schema without a validator passes it unchanged. A
 * failure is a ValidationError naming the tool and the issues, never the value.
 */
export async function validateToolInput(
    toolName: string,
    schema: FlexibleSchema<unknown> | undefined,
    input: unknown,
    what = 'the input beforeToolExecution returned',
): Promise<unknown> {
    const { validate } = asSchema(schema);

    if (!validate) {
        return input;
    }

    const result = await validate(input);

    if (result.success) {
        return result.value;
    }

    const cause = TypeValidationError.isInstance(result.error) ? result.error.cause : undefined;
    const issues = Array.isArray(cause) ?
        buildIssuesForStandardSchemaIssues(cause as StandardSchemaV1.Issue[]) :
        [];
    const detail = issues.length > 0 ? `: ${describeIssues(issues)}` : '.';
    throw new ValidationError(
        `Tool "${toolName}": ${what} does not match the tool's input schema${detail}`,
        issues,
    );
}
