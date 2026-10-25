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

/** Characters of an HTML page converted at most (its start); the conversion grows faster than linear with size. */
export const HTML_MAX_CHARS = 1_048_576;

/** Element nesting a converted page may reach (Blink's parser limit); a deeper one is refused before parsing. */
export const HTML_MAX_DEPTH = 512;

/** The heap limit of the conversion worker. */
export const CONVERT_MAX_HEAP_MB = 512;

/** Elements that never hold content, so they never nest. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'keygen',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);

/** Elements whose end tag may be left out (the next sibling closes them), so they are not counted as nesting. */
export const OPTIONAL_END_ELEMENTS: ReadonlySet<string> = new Set([
    'html',
    'head',
    'body',
    'p',
    'li',
    'dt',
    'dd',
    'tr',
    'td',
    'th',
    'thead',
    'tbody',
    'tfoot',
    'colgroup',
    'caption',
    'option',
    'optgroup',
    'rb',
    'rt',
    'rtc',
    'rp',
]);

/** Elements whose content is text up to their end tag, never markup. */
export const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
    'script',
    'style',
    'textarea',
    'title',
    'xmp',
]);

/** Elements whose content is foreign (svg, math): there a self-closed tag closes. */
export const FOREIGN_ELEMENTS: ReadonlySet<string> = new Set([
    'svg',
    'math',
]);

/** Foreign elements whose content is HTML again (lower-cased), so a self-closed tag in them opens. */
export const HTML_INTEGRATION_ELEMENTS: ReadonlySet<string> = new Set([
    'foreignobject',
    'desc',
    'title',
    'annotation-xml',
]);

/** HTML elements that end the foreign content they appear in (the HTML parser's breakout list). */
export const FOREIGN_BREAKOUT_ELEMENTS: ReadonlySet<string> = new Set([
    'b',
    'big',
    'blockquote',
    'body',
    'br',
    'center',
    'code',
    'dd',
    'div',
    'dl',
    'dt',
    'em',
    'embed',
    'font',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'head',
    'hr',
    'i',
    'img',
    'li',
    'listing',
    'menu',
    'meta',
    'nobr',
    'ol',
    'p',
    'pre',
    'ruby',
    's',
    'small',
    'span',
    'strike',
    'strong',
    'sub',
    'sup',
    'table',
    'tt',
    'u',
    'ul',
    'var',
]);
