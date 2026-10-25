/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Elements dropped before a page is converted: code, embeds and page chrome. */
export const DROPPED_ELEMENTS = [
    'script',
    'style',
    'noscript',
    'template',
    'iframe',
    'object',
    'embed',
    'svg',
    'canvas',
    'nav',
    'aside',
    'footer',
    'form',
    'button',
    'select',
    'dialog',
].join(',');

/** Elements that start a new line in text mode. */
export const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
    'ADDRESS', 
    'ARTICLE', 
    'BLOCKQUOTE', 
    'BR', 
    'DD', 
    'DETAILS', 
    'DIV', 
    'DL', 
    'DT', 
    'FIGCAPTION', 
    'FIGURE',
    'H1', 
    'H2', 
    'H3', 
    'H4', 
    'H5', 
    'H6', 
    'HEADER', 
    'HR', 
    'LI', 
    'MAIN', 
    'OL', 
    'P', 
    'PRE', 
    'SECTION',
    'SUMMARY', 
    'TABLE', 
    'TD', 
    'TH', 
    'TR', 
    'UL',
]);

/** URL schemes a converted link may keep. */
export const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

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
