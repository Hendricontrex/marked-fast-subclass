// OptimizedTokenizer — a subclass of marked 18.1.3's Tokenizer (from the
// vendored library in ../vendor/marked/marked.esm.js, used unchanged) with
// two speed optimizations that keep output byte-identical:
//
//  1. list(): one combined "end of item" regex per line instead of six
//     separate .test() calls, plus indexOf() instead of split() for line
//     ends, so sliced strings are never flattened per line.
//  2. Inline methods: a cheap first-character guard, so rules whose
//     ^-anchored regex cannot match are skipped without running it.
//
// Everything here is written for this entry; the marked library itself is
// vendored untouched and only subclassed.
import { Tokenizer } from '../vendor/marked/marked.esm.js';

// First line of `s` (up to the first \n, exclusive), without splitting:
// split() flattens a sliced string, copying the whole remainder once per line.
function firstLineOf(s) {
    const i = s.indexOf('\n');
    return i === -1 ? s : s.slice(0, i);
}

// Expand tabs to spaces, tracking the column from `indent` (tab stops of 4).
function expandTabs(line, indent = 0) {
    let col = indent;
    let expanded = '';
    for (const char of line) {
        if (char === '\t') {
            const added = 4 - (col % 4);
            expanded += ' '.repeat(added);
            col += added;
        }
        else {
            expanded += char;
            col++;
        }
    }
    return expanded;
}

// Cache a regex factory by indent, clamped to 0..3 (same scheme marked uses
// for its own begin-regexes).
function cachedIndentRegex(createRegex) {
    const cache = [];
    return (indent) => {
        const cacheIndex = Math.max(0, Math.min(3, indent - 1));
        let regex = cache[cacheIndex];
        if (!regex) {
            regex = createRegex(cacheIndex);
            cache[cacheIndex] = regex;
        }
        return regex;
    };
}

// Strip the `^ {0,N}` anchor from a begin-regex's .source, leaving the
// inner pattern (which never depends on the indent).
function stripBeginAnchor(source) {
    return source.replace(/^\^ \{0,\d\}/, '');
}

// Combined "end of list item" regexes, built from the individual begin
// regexes in `other` (their .source, anchor stripped, joined with `|`).
// The result is only ever used with .test(), so inner capturing groups are
// harmless. The whole regex carries the 'i' flag for the html alternative;
// the other alternatives contain no letters, so it changes nothing for
// them. (Do NOT use (?i:...) inline flags here: V8 mis-matches all-caps
// tag names like DIV under an inline flag when the alternation is long.)
let breakRegexes = null; // built lazily from the first list() call's rules
function getBreakRegexes(other) {
    if (breakRegexes) return breakRegexes;
    const bullet = stripBeginAnchor(other.nextBulletRegex(0).source);
    const hr = stripBeginAnchor(other.hrRegex(0).source);
    const fences = stripBeginAnchor(other.fencesBeginRegex(0).source);
    const heading = stripBeginAnchor(other.headingBeginRegex(0).source);
    const pedanticHeading = stripBeginAnchor(other.pedanticHeadingBeginRegex(0).source);
    const html = stripBeginAnchor(other.htmlBeginRegex(0).source);
    const blockquote = stripBeginAnchor(other.blockquoteBeginRegex(0).source);
    // Per-line test: a new bullet, hr, fence, heading, html block or
    // blockquote ends the list item.
    const item = (h) => cachedIndentRegex((i) => new RegExp('^ {0,' + i + '}(?:' + bullet + '|' + hr + '|' + fences + '|' + h + '|' + html + '|' + blockquote + ')', 'i'));
    // Lazy-continuation branch: only fences, heading, html or hr end it
    // (a bullet or blockquote does not end a paragraph here).
    const line = (h) => cachedIndentRegex((i) => new RegExp('^ {0,' + i + '}(?:' + hr + '|' + fences + '|' + h + '|' + html + ')', 'i'));
    breakRegexes = {
        item: item(heading),
        itemPedantic: item(pedanticHeading),
        line: line(heading),
        linePedantic: line(pedanticHeading),
    };
    return breakRegexes;
}

// A GFM autolink (url) can only start with www., a scheme, or an email
// address; this is a superset of the url rule's starts, so it is safe to
// skip the url regex when it does not match. (Without it the text regex
// alone would wrongly swallow "www.example.com" as text.)
const urlStartTest = /^(?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:|mailto:|xmpp:|[A-Za-z0-9._+-]+@)/;

export class OptimizedTokenizer extends Tokenizer {
    list(src) {
        let cap = this.rules.block.list.exec(src);
        if (cap) {
            // src is only consumed from the front, so every raw below is a slice of
            // listSrc rather than a string built up line by line
            const listSrc = src;
            const taken = () => listSrc.length - src.length;
            let bull = cap[1].trim();
            const isordered = bull.length > 1;
            const list = {
                type: 'list',
                raw: '',
                ordered: isordered,
                start: isordered ? +bull.slice(0, -1) : '',
                loose: false,
                items: [],
            };
            bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
            if (this.options.pedantic) {
                bull = isordered ? bull : '[*+-]';
            }
            // Get next list item
            const itemRegex = this.rules.other.listItemRegex(bull);
            let endsWithBlankLine = false;
            // Check if current bullet point can start a new List Item
            while (src) {
                let endEarly = false;
                let itemContents = '';
                if (!(cap = itemRegex.exec(src))) {
                    break;
                }
                if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
                    break;
                }
                const itemStart = taken();
                src = src.substring(cap[0].length);
                const firstLine = firstLineOf(cap[2]);
                const bulletIndent = cap[1].length;
                let line = this.options.pedantic
                    ? expandTabs(firstLine, bulletIndent)
                    : firstLine.replace(this.rules.other.leadingSpaceTab, whitespace => expandTabs(whitespace, bulletIndent));
                let nextLine = firstLineOf(src);
                let blankLine = !line.trim();
                let indent = 0;
                if (this.options.pedantic) {
                    indent = 2;
                    itemContents = line.trimStart();
                }
                else if (blankLine) {
                    indent = bulletIndent + 1;
                }
                else {
                    indent = line.search(this.rules.other.nonSpaceChar); // Find first non-space char
                    indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
                    itemContents = line.slice(indent);
                    indent += bulletIndent;
                }
                if (blankLine && this.rules.other.blankLine.test(nextLine)) { // Items begin with at most one blank line
                    src = src.substring(nextLine.length + 1);
                    endEarly = true;
                }
                if (!endEarly) {
                    // One combined test replaces the six separate .test() calls
                    // (fences, heading, html, blockquote, next bullet, hr) below,
                    // and one for the lazy-continuation branch (no bullet/blockquote).
                    const breaks = getBreakRegexes(this.rules.other);
                    const itemBreakRegex = this.options.pedantic
                        ? breaks.itemPedantic(indent)
                        : breaks.item(indent);
                    const lineBreakRegex = this.options.pedantic
                        ? breaks.linePedantic(indent)
                        : breaks.line(indent);
                    // Check if following lines should be included in List Item
                    while (src) {
                        const rawLine = firstLineOf(src);
                        let nextLineWithoutTabs;
                        nextLine = rawLine;
                        // Re-align to follow commonmark nesting rules
                        if (this.options.pedantic) {
                            nextLine = nextLine.replace(this.rules.other.listReplaceNesting, '  ');
                            nextLineWithoutTabs = nextLine;
                        }
                        else {
                            nextLineWithoutTabs = nextLine.replace(this.rules.other.leadingSpaceTab, whitespace => expandTabs(whitespace));
                        }
                        // End list item if the next line starts a new block
                        // (fence, heading, html, blockquote, bullet, hr).
                        if (itemBreakRegex.test(nextLine)) {
                            break;
                        }
                        // First non-space char of the tab-expanded line; -1 when blank.
                        // (Leading tabs were expanded above, so -1 means all whitespace.)
                        const firstNonSpace = nextLineWithoutTabs.search(this.rules.other.nonSpaceChar);
                        if (firstNonSpace >= indent || firstNonSpace === -1) { // Dedent if possible
                            itemContents += '\n' + nextLineWithoutTabs.slice(indent);
                        }
                        else {
                            // not enough indentation
                            if (blankLine) {
                                break;
                            }
                            // paragraph continuation unless last line was a different block level element
                            // (line has no leading tabs: they were expanded when it was built,
                            // so the tab replace the original did here cannot move the search)
                            if (line.search(this.rules.other.nonSpaceChar) >= 4) { // indented code block
                                break;
                            }
                            if (lineBreakRegex.test(line)) {
                                break;
                            }
                            // A lazy continuation can look like a setext underline after
                            // list indentation is removed. Keep it in the paragraph.
                            const setextContinuation = !this.options.pedantic
                                && /^ {0,3}(?:=+|-+) *$/.test(nextLine)
                                && this.rules.block.lheading.test(`${line}\n${nextLine}`);
                            const continuation = setextContinuation
                                ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
                                : nextLine;
                            itemContents += '\n' + continuation;
                        }
                        blankLine = firstNonSpace === -1;
                        src = src.substring(rawLine.length + 1);
                        line = nextLineWithoutTabs.slice(indent);
                    }
                }
                // The loops above appended a '\n' the source may not have had. It could
                // only land on the item that exhausts src, whose raw is trimmed below,
                // and after which nothing reads endsWithBlankLine
                const raw = listSrc.slice(itemStart, taken());
                if (!list.loose) {
                    // If the previous item ended with a blank line, the list is loose
                    if (endsWithBlankLine) {
                        list.loose = true;
                    }
                    else if (this.rules.other.doubleBlankLine.test(raw)) {
                        endsWithBlankLine = true;
                    }
                }
                list.items.push({
                    type: 'list_item',
                    raw,
                    task: !!this.options.gfm && this.rules.other.listIsTask.test(itemContents),
                    loose: false,
                    text: itemContents,
                    tokens: [],
                });
            }
            // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
            const lastItem = list.items.at(-1);
            if (lastItem) {
                lastItem.raw = lastItem.raw.trimEnd();
                lastItem.text = lastItem.text.trimEnd();
            }
            else {
                // not a list since there were no items
                return;
            }
            list.raw = listSrc.slice(0, taken()).trimEnd();
            // Item child tokens handled here at end because we needed to have the final item to trim it first
            // First pass: tokenize items and finalize list.loose from spacers before placing checkboxes
            for (const item of list.items) {
                this.lexer.state.top = false;
                item.tokens = this.lexer.blockTokens(item.text, []);
                if (!list.loose) {
                    // Check if list should be loose
                    const spacers = item.tokens.filter(t => t.type === 'space');
                    const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => this.rules.other.anyLine.test(t.raw));
                    list.loose = hasMultipleLineBreaks;
                }
            }
            // Second pass: place task checkboxes using the final list.loose
            for (const item of list.items) {
                const itemToken = item.tokens[0];
                if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
                    // Remove checkbox markdown from item tokens
                    item.text = item.text.replace(this.rules.other.listReplaceTask, '');
                    itemToken.raw = itemToken.raw.replace(this.rules.other.listReplaceTask, '');
                    itemToken.text = itemToken.text.replace(this.rules.other.listReplaceTask, '');
                    for (let i = this.lexer.inlineQueue.length - 1; i >= 0; i--) {
                        if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[i].src)) {
                            this.lexer.inlineQueue[i].src = this.lexer.inlineQueue[i].src.replace(this.rules.other.listReplaceTask, '');
                            break;
                        }
                    }
                    const taskRaw = this.rules.other.listTaskCheckbox.exec(item.raw);
                    if (taskRaw) {
                        const checkboxToken = {
                            type: 'checkbox',
                            raw: taskRaw[0] + ' ',
                            checked: taskRaw[0] !== '[ ]',
                        };
                        item.checked = checkboxToken.checked;
                        if (list.loose) {
                            if (item.tokens[0] && ['paragraph', 'text'].includes(item.tokens[0].type) && 'tokens' in item.tokens[0] && item.tokens[0].tokens) {
                                item.tokens[0].raw = checkboxToken.raw + item.tokens[0].raw;
                                item.tokens[0].text = checkboxToken.raw + item.tokens[0].text;
                                item.tokens[0].tokens.unshift(checkboxToken);
                            }
                            else {
                                item.tokens.unshift({
                                    type: 'paragraph',
                                    raw: checkboxToken.raw,
                                    text: checkboxToken.raw,
                                    tokens: [checkboxToken],
                                });
                            }
                        }
                        else {
                            item.tokens.unshift(checkboxToken);
                        }
                    }
                }
                else if (item.task) {
                    item.task = false;
                }
            }
            // Set all items to loose if list is loose
            if (list.loose) {
                for (const item of list.items) {
                    item.loose = true;
                    for (const token of item.tokens) {
                        if (token.type === 'text') {
                            token.type = 'paragraph';
                        }
                    }
                }
            }
            return list;
        }
    }

    // --- Inline methods: first-character guards --------------------------
    // Each rule's regex is ^-anchored and needs a specific trigger char.
    // When the first char cannot match, the method would return undefined
    // anyway, so return early without running the regex.

    escape(src) {
        if (src.charCodeAt(0) !== 92) return undefined; // backslash
        return super.escape(src);
    }

    tag(src) {
        if (src.charCodeAt(0) !== 60) return undefined; // <
        return super.tag(src);
    }

    link(src) {
        const c0 = src.charCodeAt(0);
        if (c0 !== 91 && c0 !== 33) return undefined; // [ or ! (image)
        return super.link(src);
    }

    reflink(src, links) {
        const c0 = src.charCodeAt(0);
        if (c0 !== 91 && c0 !== 33) return undefined; // [ or ! (image)
        return super.reflink(src, links);
    }

    emStrong(src, maskedSrc, prevChar = '') {
        const c0 = src.charCodeAt(0);
        if (c0 !== 42 && c0 !== 95) return undefined; // * or _
        return super.emStrong(src, maskedSrc, prevChar);
    }

    codespan(src) {
        if (src.charCodeAt(0) !== 96) return undefined; // backtick
        return super.codespan(src);
    }

    br(src) {
        const c0 = src.charCodeAt(0);
        if (c0 !== 32 && c0 !== 92) return undefined; // space or backslash
        return super.br(src);
    }

    del(src, maskedSrc, prevChar = '') {
        if (src.charCodeAt(0) !== 126) return undefined; // ~
        return super.del(src, maskedSrc, prevChar);
    }

    autolink(src) {
        if (src.charCodeAt(0) !== 60) return undefined; // <
        return super.autolink(src);
    }

    url(src) {
        if (!src.startsWith('www.') && !urlStartTest.test(src)) return undefined;
        return super.url(src);
    }
}
