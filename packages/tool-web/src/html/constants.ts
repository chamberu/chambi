/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Media types read as text besides `text/*`. */
export const TEXT_MEDIA_TYPES: ReadonlySet<string> = new Set([
    'application/json',
    'application/xml',
    'application/javascript',
    'application/ecmascript',
    'application/x-javascript',
    'application/x-sh',
    'application/toml',
    'application/yaml',
    'application/x-yaml',
    'application/x-ndjson',
]);

/** Elements dropped when a page has no main content to isolate: navigation, page chrome and forms. */
export const PAGE_CHROME_ELEMENTS = [
    'nav',
    'header',
    'footer',
    'aside',
    'form',
    'fieldset',
    'button',
    'input',
    'select',
    'textarea',
    'iframe',
    'object',
    'embed',
] as const;

/** The YAML frontmatter mdream puts before the content (the title is read through its callback). */
export const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/;
