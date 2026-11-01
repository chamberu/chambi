/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import {
    EXTRACT_ARRAY_MAX_ITEMS,
    EXTRACT_OBJECT_MAX_PROPERTIES,
    EXTRACT_STRING_MAX_LENGTH,
    EXTRACT_TEXT_MAX_LENGTH,
} from './constants.ts';

function isLiteral(value: unknown): boolean {
    return value === null || typeof value === 'boolean' || typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value));
}

function isBound(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

const ANNOTATIONS = new Set(['$schema', 'title', 'description', 'default', 'examples']);

/**
 * An anchored pattern: `^` first and an unescaped `$` last. The output check
 * still wraps it as `^(?:...)$`, so an inner alternation cannot unanchor it.
 */
function isAnchoredPattern(pattern: unknown): pattern is string {
    if (typeof pattern !== 'string' || pattern.length < 2 || !pattern.startsWith('^') || !pattern.endsWith('$')) {
        return false;
    }

    let backslashes = 0;

    for (let index = pattern.length - 2; index >= 0 && pattern[index] === '\\'; index--) {
        backslashes++;
    }

    return backslashes % 2 === 0;
}

/** The most free-text characters a schema accepted by isShapeSafe() can carry. */
function textLength(schema: Record<string, unknown>): number {
    if (Object.hasOwn(schema, 'const') || Object.hasOwn(schema, 'enum')) {
        return 0;
    }

    switch (schema.type) {
        case 'string': {
            return schema.maxLength as number;
        }
        case 'array': {
            return (schema.maxItems as number) * textLength(schema.items as Record<string, unknown>);
        }
        case 'object': {
            return Object.values((schema.properties ?? {}) as Record<string, Record<string, unknown>>)
                .reduce((sum, property) => sum + textLength(property), 0);
        }
        default: {
            return 0;
        }
    }
}

/**
 * A deliberately small allowlist, not a general JSON Schema interpreter.
 * Unknown keywords, references and combinators cannot establish a trust boundary.
 * Strings need an anchored pattern and a maxLength, objects at most
 * EXTRACT_OBJECT_MAX_PROPERTIES properties, and the whole schema at most
 * EXTRACT_TEXT_MAX_LENGTH free-text characters.
 */
export function isSafeExtractionSchema(schema: unknown): boolean {
    return isShapeSafe(schema, new Set()) && textLength(schema as Record<string, unknown>) <= EXTRACT_TEXT_MAX_LENGTH;
}

function isShapeSafe(schema: unknown, ancestors: Set<object>): boolean {
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
                    isAnchoredPattern(schema.pattern) &&
                    isBound(schema.maxLength, EXTRACT_STRING_MAX_LENGTH);
            }
            case 'array': {
                return only('type', 'items', 'minItems', 'maxItems', 'uniqueItems') &&
                    isBound(schema.maxItems, EXTRACT_ARRAY_MAX_ITEMS) &&
                    isShapeSafe(schema.items, ancestors);
            }
            case 'object': {
                const properties = schema.properties ?? {};

                return only('type', 'properties', 'required', 'additionalProperties', 'minProperties', 'maxProperties') &&
                    schema.additionalProperties === false && isObject(properties) &&
                    Object.keys(properties).length <= EXTRACT_OBJECT_MAX_PROPERTIES &&
                    Object.values(properties).every((property) => isShapeSafe(property, ancestors));
            }
            default: {
                return false;
            }
        }
    } finally {
        ancestors.delete(schema);
    }
}
