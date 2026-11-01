/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The most free-text characters one string field of a safe extraction schema may carry. */
export const EXTRACT_STRING_MAX_LENGTH = 200;

/** The most items an array of a safe extraction schema may hold. */
export const EXTRACT_ARRAY_MAX_ITEMS = 10;

/** The most properties an object of a safe extraction schema may declare. */
export const EXTRACT_OBJECT_MAX_PROPERTIES = 32;

/** The most free-text characters a whole safe extraction schema may carry (string maxLength times array maxItems, summed). */
export const EXTRACT_TEXT_MAX_LENGTH = 1000;

/** The most characters the serialized output of a safe extraction may have. */
export const EXTRACT_OUTPUT_MAX_LENGTH = 16_384;
