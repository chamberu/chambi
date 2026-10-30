/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';

function isLiteral(value: unknown): boolean {
    return value === null || typeof value === 'boolean' || typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value));
}

function isBound(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

const ANNOTATIONS = new Set(['$schema', 'title', 'description', 'default', 'examples']);

/**
 * A deliberately small allowlist, not a general JSON Schema interpreter.
 * Unknown keywords, references and combinators cannot establish a trust boundary.
 */
export function isSafeExtractionSchema(schema: unknown, ancestors = new Set<object>()): boolean {
    if (!isObject(schema) || ancestors.has(schema)) {
        return false;
    }

    ancestors.add(schema);

    try {
        const keys = Object.keys(schema).filter((key) => !ANNOTATIONS.has(key));
        const only = (...allowed: string[]) => keys.every((key) => allowed.includes(key));

        if (Object.hasOwn(schema, 'const')) {
            return only('type', 'const') && isLiteral(schema.const);
        }

        if (Object.hasOwn(schema, 'enum')) {
            return only('type', 'enum') && Array.isArray(schema.enum) && schema.enum.length > 0 &&
                schema.enum.every(isLiteral);
        }

        switch (schema.type) {
            case 'boolean':
            case 'null': {
                return only('type');
            }
            case 'number':
            case 'integer': {
                return only('type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf');
            }
            case 'string': {
                return only('type', 'pattern', 'minLength', 'maxLength') &&
                    typeof schema.pattern === 'string' && schema.pattern.length > 0 &&
                    isBound(schema.maxLength, 200);
            }
            case 'array': {
                return only('type', 'items', 'minItems', 'maxItems', 'uniqueItems') &&
                    isBound(schema.maxItems, 10) &&
                    isSafeExtractionSchema(schema.items, ancestors);
            }
            case 'object': {
                const properties = schema.properties ?? {};

                return only('type', 'properties', 'required', 'additionalProperties', 'minProperties', 'maxProperties') &&
                    schema.additionalProperties === false && isObject(properties) &&
                    Object.values(properties).every((property) => isSafeExtractionSchema(property, ancestors));
            }
            default: {
                return false;
            }
        }
    } finally {
        ancestors.delete(schema);
    }
}
