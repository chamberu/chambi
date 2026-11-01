/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** The heading of a choice approval's options. */
export const OPTIONS_HEADING = 'Options (choose one):';

/** The heading of a choice approval whose options may be selected together. */
export const MULTIPLE_OPTIONS_HEADING = 'Options (choose one or more):';

/**
 * The fewest characters of an approval's title and body a cut keeps (before
 * its note); an approval whose options, expiry and link leave less is refused.
 */
export const PROSE_MIN_CHARS = 32;

/** Thrown error texts of a transport are cut to this many characters. */
export const ERROR_TEXT_MAX_LENGTH = 500;
