// A faster Tokenizer for marked 18.1.3.
//
// Two ideas, both output-identical by construction:
//  1. Inline rules are all anchored at the start of the remaining source, so
//     each one can only match when the first character is one of a tiny set.
//     We test that character first and skip the rule's pattern entirely when
//     it cannot match. The parent method still does all real matching.
//  2. Lists are scanned line by line with indexOf instead of being split,
//     and the per-line "does this line end the current item" decision is one
//     first-character dispatch instead of a run of separate rule tests.
//
// Everything else is inherited from marked's Tokenizer unchanged.

import { Tokenizer } from '../vendor/marked/marked.esm.js';

// How many spaces may precede a block start (the block rules allow 0-3).
const MAX_LEAD = 3;

// Character codes used by the guards below.
const CC = {
  space: 32,
  tab: 9,
  bang: 33,
  hash: 35,
  star: 42,
  plus: 43,
  dash: 45,
  dot: 46,
  digit0: 48,
  digit9: 57,
  lt: 60,
  backtick: 96,
  tilde: 126,
  underscore: 95,
  backslash: 92,
  bracket: 91,
  gt: 62,
  upperA: 65,
  upperZ: 90,
  lowerA: 97,
  lowerZ: 122,
  closeParen: 41,
};

export class FastTokenizer extends Tokenizer {

  // --- inline rules: first-character guards, then the parent method ---

  escape(src) {
    return src.charCodeAt(0) === CC.backslash ? super.escape(src) : undefined;
  }

  tag(src) {
    return src.charCodeAt(0) === CC.lt ? super.tag(src) : undefined;
  }

  link(src) {
    const c = src.charCodeAt(0);
    return c === CC.bracket || c === CC.bang ? super.link(src) : undefined;
  }

  reflink(src, links) {
    const c = src.charCodeAt(0);
    return c === CC.bracket || c === CC.bang
      ? super.reflink(src, links)
      : undefined;
  }

  emStrong(src, maskedSrc, prevChar) {
    const c = src.charCodeAt(0);
    return c === CC.star || c === CC.underscore
      ? super.emStrong(src, maskedSrc, prevChar)
      : undefined;
  }

  codespan(src) {
    return src.charCodeAt(0) === CC.backtick
      ? super.codespan(src)
      : undefined;
  }

  br(src) {
    const c = src.charCodeAt(0);
    return c === CC.space || c === CC.backslash ? super.br(src) : undefined;
  }

  del(src, maskedSrc, prevChar) {
    return src.charCodeAt(0) === CC.tilde
      ? super.del(src, maskedSrc, prevChar)
      : undefined;
  }

  autolink(src) {
    return src.charCodeAt(0) === CC.lt ? super.autolink(src) : undefined;
  }

  url(src) {
    // A bare link can only start with www., a scheme (http/https/ftp),
    // mailto:/xmpp:, or an email address, so the first character must be a
    // letter, a digit, or one of . _ + -.
    const c = src.charCodeAt(0);
    const ok =
      (c >= CC.digit0 && c <= CC.digit9) ||
      (c >= CC.upperA && c <= CC.upperZ) ||
      (c >= CC.lowerA && c <= CC.lowerZ) ||
      c === CC.dot ||
      c === CC.underscore ||
      c === CC.plus ||
      c === CC.dash;
    return ok ? super.url(src) : undefined;
  }

  // --- block rule: the fast list tokenizer ---
  //
  // marked's list rule only matches the first line of a list, so the rest
  // is a line scan. We walk the source with indexOf, one line at a time,
  // and decide per line whether it starts a new item, continues the current
  // one (indented), continues it lazily, is a blank line, or ends the list.
  // The per-line decision is a first-character dispatch (see interrupts()
  // and blocksLazy() below), not a run of separate rule tests, and lines
  // are never split: outdenting works on the line slice in place.
  list(src) {
    // The Lexer fills in this.rules only after construction, so the HTML
    // block-start test is built on first use, from the html rule this
    // Tokenizer already carries.
    if (!this._htmlStart) this._htmlStart = buildHtmlStart(this.rules.block.html.source);
    return scanList(this, src);
  }
}

// A setext underline is a run of = (any length) or exactly -- (--- and
// longer are thematic breaks, a lone - is a bullet), with only spaces or
// tabs after it. Left alone it would turn the paragraph above it into a
// setext heading when the item text is lexed again, so a lazy one is
// indented by four spaces to keep it plain text.
function isSetextLine(line) {
  if (line.length === 0) return false;
  const c = line.charCodeAt(0);
  let i = 0;
  if (c === 61) {
    while (i < line.length && line.charCodeAt(i) === 61) i++;
  } else if (c === CC.dash) {
    while (i < line.length && line.charCodeAt(i) === CC.dash) i++;
    if (i !== 2) return false;
  } else return false;
  while (i < line.length) {
    const d = line.charCodeAt(i);
    if (d !== CC.space && d !== CC.tab) return false;
    i++;
  }
  return true;
}

// A fence-looking line: 0-3 spaces then a run of 3+ backticks or tildes,
// whatever follows. (The previous line blocks lazy continuation when it
// looks like a fence, even when its info string holds a backtick and the
// real fence rule would not call it one.)
function fenceLike(line) {
  let i = 0;
  while (i < line.length && i < MAX_LEAD && line.charCodeAt(i) === CC.space) i++;
  if (i >= line.length) return false;
  const ch = line.charCodeAt(i);
  if (ch !== CC.backtick && ch !== CC.tilde) return false;
  let j = i;
  while (j < line.length && line.charCodeAt(j) === ch) j++;
  return j - i >= 3;
}

// Build the HTML-block-start test from the html block rule's own source.
// The one rule we cannot hand-roll cheaply is the HTML-block start: it
// needs the CommonMark block-tag list. That list lives inside the html
// block rule this Tokenizer already carries, so pull it out of the rule
// instead of writing it down here.
function buildHtmlStart(htmlSrc) {
  const found = /<\\\/\?\(address\|([^)]*)\)/.exec(htmlSrc);
  const tags = found ? found[1] : '';
  const tagPart = tags
    ? '<\\/?(?:' + tags + ')(?:[ \\t]|\\/?>|$)'
    : '(?!)';
  return new RegExp(
    '^ {0,3}(?:' +
      tagPart +
      '|' +
      '<(?:script|pre|style|textarea)(?:[\\s>]|$)' +
      '|<!--|<\\?|<![A-Za-z]|<!\\[CDATA\\[' +
      ')'
  );
}

// ---------- the list scan ----------

function scanList(tok, src) {
  const cap = tok.rules.block.list.exec(src);
  if (!cap) return undefined;
  const htmlRe = tok._htmlStart;
  const first = cap[1];
  let bi = 0;
  while (bi < first.length && first.charCodeAt(bi) === CC.space) bi++;
  const bull = first.slice(bi);
  const ordered = bull.length > 1;
  const listDelim = ordered ? bull[bull.length - 1] : bull;
  const start = ordered ? +bull.slice(0, -1) : '';
  const fc = firstContent(bi, bull, cap[2] || '');

  const items = [];
  let curRaw = [cap[0]];
  let curText = [fc.content];
  let curW = fc.W;
  let curHasContent = fc.content !== '';
  let curPrevBlocks = false;
  let curPrevIsBq = false;
  let curPrevIsBull = false;
  let pending = [];
  let loose = false;
  let blankPending = false;
  const doubleBlank = tok.rules.other.doubleBlankLine;

  // Per-content-line bookkeeping for the lazy rules and the setext pad.
  // `out` is the line as it appears in the item text; `raw` is the line as
  // it appears in the source.
  function noteContent(out, raw) {
    const rawLine = raw.charCodeAt(raw.length - 1) === 10 ? raw.slice(0, -1) : raw;
    curPrevBlocks = blocksLazy(rawLine, htmlRe) || fenceLike(rawLine);
    if (out !== '') curHasContent = true;
    curPrevIsBq = /^ {0,3}>/.test(out);
    curPrevIsBull = readBullet(out) !== null;
  }

  function closeItem(keepBlanks) {
    if (keepBlanks && pending.length > 0) {
      for (let k = 0; k < pending.length; k++) {
        curRaw.push(pending[k]);
        curText.push('');
      }
    }
    pending.length = 0;
    let task = false;
    let checked;
    const head = curText[0];
    const m = /^\[([ xX])\][ \t]+/.exec(head);
    if (m !== null && head.length > m[0].length) {
      task = true;
      checked = m[1] === 'x' || m[1] === 'X';
      curText[0] = head.slice(m[0].length);
    }
    const item = { type: 'list_item', raw: curRaw.join(''), task, loose: false, text: curText.join('\n') };
    if (task) item.checked = checked;
    items.push(item);
    // Loose, the parent's first way: an item whose raw ends with a blank
    // line arms a flag, and the next item built while it is armed makes
    // the whole list loose.
    if (!loose) {
      if (blankPending) loose = true;
      else if (doubleBlank.test(item.raw)) blankPending = true;
    }
  }

  // The first line's own bookkeeping.
  noteContent(fc.content, cap[0]);

  let pos = cap[0].length;
  while (pos < src.length) {
    const eol = src.indexOf('\n', pos);
    const lineEnd = eol === -1 ? src.length : eol;
    const line = src.slice(pos, lineEnd);
    const term = eol === -1 ? '' : '\n';
    pos = lineEnd + 1;
    const info = leadInfo(line);
    if (info.blank) {
      pending.push(line + term);
      continue;
    }
    const b = readBullet(line);
    if (b !== null && b.indent < curW && b.ordered === ordered && b.delim === listDelim && !isHr(line)) {
      closeItem(true);
      const fc2 = firstContent(b.indent, b.marker, line.slice(b.end));
      curRaw = [line + term];
      curText = [fc2.content];
      curW = fc2.W;
      curHasContent = fc2.content !== '';
      curPrevBlocks = false;
      curPrevIsBq = false;
      curPrevIsBull = false;
      noteContent(fc2.content, line + term);
      continue;
    }
    const out = outdent(line, info, curW);
    if (out !== null) {
      // Indented continuation: first settle any pending blank lines. An
      // empty item cannot continue after a blank line; the list ends.
      // Whether the blank group makes the list loose is decided later,
      // from the item's re-lexed tokens, as the parent does.
      if (pending.length > 0) {
        if (!curHasContent) break;
        for (let k = 0; k < pending.length; k++) {
          curRaw.push(pending[k]);
          curText.push('');
        }
        pending.length = 0;
      }
      curRaw.push(line + term);
      curText.push(out);
      noteContent(out, line + term);
      continue;
    }
    // Lazy candidate: indent below the content column, not a new item.
    if (interrupts(line, htmlRe) || curPrevBlocks || !curHasContent || pending.length > 0) {
      break;
    }
    let content = line;
    if (isSetextLine(line) && !curPrevIsBq && !curPrevIsBull) content = '    ' + line;
    curRaw.push(line + term);
    curText.push(content);
    noteContent(content, line + term);
  }
  // End of input (or of the list): close the last item, dropping trailing
  // blank lines.
  closeItem(false);
  // The last item's raw and text drop trailing whitespace, and each item's
  // text is lexed into its tokens with the lexer below top level, as the
  // parent does (that is what makes a tight item's text a text token
  // instead of a paragraph).
  const last = items[items.length - 1];
  last.raw = last.raw.trimEnd();
  last.text = last.text.trimEnd();
  // Loose, the parent's second way: an item whose re-lexed tokens hold a
  // space token spanning a blank line makes the whole list loose. A blank
  // inside a fence, a code block, or a nested list never surfaces as such
  // a space token, so those cases are tight without any special-casing.
  const anyLine = tok.rules.other.anyLine;
  for (let k = 0; k < items.length; k++) {
    tok.lexer.state.top = false;
    items[k].tokens = tok.lexer.blockTokens(items[k].text, []);
    if (!loose) {
      for (let j = 0; j < items[k].tokens.length; j++) {
        const tk = items[k].tokens[j];
        if (tk.type === 'space' && anyLine.test(tk.raw)) { loose = true; break; }
      }
    }
  }
  for (let k = 0; k < items.length; k++) items[k].loose = loose;
  // Task checkboxes: the parent puts a checkbox token at the front of the
  // item's tokens (or, for a loose list, at the front of the first
  // paragraph's inline tokens). An item whose first token is not text or
  // a paragraph is not a task after all.
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (!it.task) continue;
    const first = it.tokens[0];
    if (first && (first.type === 'text' || first.type === 'paragraph')) {
      const m = tok.rules.other.listTaskCheckbox.exec(it.raw);
      if (m) {
        const cb = { type: 'checkbox', raw: m[0] + ' ', checked: m[0] !== '[ ]' };
        it.checked = cb.checked;
        if (loose) {
          if (first.tokens) {
            first.raw = cb.raw + first.raw;
            first.text = cb.raw + first.text;
            first.tokens.unshift(cb);
          } else {
            it.tokens.unshift({ type: 'paragraph', raw: cb.raw, text: cb.raw, tokens: [cb] });
          }
        } else {
          it.tokens.unshift(cb);
        }
      }
    } else {
      it.task = false;
    }
  }
  // A loose list renders each item's text as paragraphs, so its text
  // tokens become paragraph tokens, as the parent does.
  if (loose) {
    for (let k = 0; k < items.length; k++) {
      for (let j = 0; j < items[k].tokens.length; j++) {
        if (items[k].tokens[j].type === 'text') items[k].tokens[j].type = 'paragraph';
      }
    }
  }
  let raw = '';
  for (let k = 0; k < items.length; k++) raw += items[k].raw;
  return { type: 'list', raw, ordered, start, loose, items };
}

// ---------- line-level helpers for the list scan ----------

// Read a bullet at the start of `line` (after 0-3 spaces). Returns null
// when the line does not start with a bullet, else {indent, marker,
// ordered, delim, end} where end is the index just past the bullet.
function readBullet(line) {
  let i = 0;
  while (i < line.length && i < MAX_LEAD && line.charCodeAt(i) === CC.space) i++;
  if (i >= line.length) return null;
  const c = line.charCodeAt(i);
  if (c === CC.star || c === CC.plus || c === CC.dash) {
    const n = line.charCodeAt(i + 1);
    if (n === CC.space || n === CC.tab || i + 1 === line.length) {
      return { indent: i, marker: line[i], ordered: false, delim: line[i], end: i + 1 };
    }
    return null;
  }
  if (c >= CC.digit0 && c <= CC.digit9) {
    let j = i;
    while (j < line.length && j - i < 9 && line.charCodeAt(j) >= CC.digit0 && line.charCodeAt(j) <= CC.digit9) j++;
    const d = line.charCodeAt(j);
    if (d !== CC.dot && d !== CC.closeParen) return null;
    const n = line.charCodeAt(j + 1);
    if (n === CC.space || n === CC.tab || j + 1 === line.length) {
      return { indent: i, marker: line.slice(i, j + 1), ordered: true, delim: line[j], end: j + 1 };
    }
  }
  return null;
}

// Thematic break: only the marker (-, _ or *) and spaces/tabs, 3+ markers.
function isHr(line) {
  let i = 0;
  while (i < line.length && i < MAX_LEAD && line.charCodeAt(i) === CC.space) i++;
  if (i >= line.length) return false;
  const m = line.charCodeAt(i);
  if (m !== CC.dash && m !== CC.underscore && m !== CC.star) return false;
  let count = 0;
  for (let j = i; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c === m) count++;
    else if (c !== CC.space && c !== CC.tab) return false;
  }
  return count >= 3;
}

// ATX heading: 1-6 '#' followed by whitespace or end of line.
function isHeading(line) {
  let i = 0;
  while (i < line.length && i < MAX_LEAD && line.charCodeAt(i) === CC.space) i++;
  let n = 0;
  while (i + n < line.length && line.charCodeAt(i + n) === CC.hash) n++;
  if (n < 1 || n > 6) return false;
  const after = line.charCodeAt(i + n);
  return i + n === line.length || after === CC.space || after === CC.tab;
}

// A fence run at the start of `line` (0-3 spaces). Returns {ch, len, rest}
// or null. For backticks the rest of the line must hold no backtick (the
// info string of a ``` fence cannot contain one).
function fenceRun(line) {
  let i = 0;
  while (i < line.length && i < MAX_LEAD && line.charCodeAt(i) === CC.space) i++;
  if (i >= line.length) return null;
  const ch = line.charCodeAt(i);
  if (ch !== CC.backtick && ch !== CC.tilde) return null;
  let j = i;
  while (j < line.length && line.charCodeAt(j) === ch) j++;
  const len = j - i;
  if (len < 3) return null;
  const rest = line.slice(j);
  if (ch === CC.backtick && rest.indexOf('`') !== -1) return null;
  return { ch, len, rest };
}

// Does this line start a block that interrupts a paragraph (and so ends
// lazy continuation of a list item)? hr, ATX heading, blockquote, fence,
// any list bullet, or an HTML block start.
function interrupts(line, htmlRe) {
  let i = 0;
  while (i < line.length && i < MAX_LEAD && line.charCodeAt(i) === CC.space) i++;
  if (i >= line.length) return false;
  const c = line.charCodeAt(i);
  if (c === CC.gt) return true;
  if (c === CC.hash) return isHeading(line);
  if (c === CC.backtick || c === CC.tilde) return fenceRun(line) !== null;
  if (c === CC.lt) return htmlRe.test(line);
  if (c === CC.dash || c === CC.underscore || c === CC.star) return isHr(line) || readBullet(line) !== null;
  if (c === CC.plus) return readBullet(line) !== null;
  if (c >= CC.digit0 && c <= CC.digit9) return readBullet(line) !== null;
  return false;
}

// Does the previous raw line close the item for lazy lines? A heading, a
// fence line, a thematic break, or an HTML block start does; blockquotes,
// nested lists, code and plain text do not.
function blocksLazy(line, htmlRe) {
  let i = 0;
  while (i < line.length && i < MAX_LEAD && line.charCodeAt(i) === CC.space) i++;
  if (i >= line.length) return false;
  const c = line.charCodeAt(i);
  if (c === CC.hash) return isHeading(line);
  if (c === CC.backtick || c === CC.tilde) return fenceRun(line) !== null;
  if (c === CC.lt) return htmlRe.test(line);
  if (c === CC.dash || c === CC.underscore || c === CC.star) return isHr(line);
  return false;
}

// Given a bullet line's pieces, work out the item's content indent W (an
// absolute column) and the first line's content text. Tabs advance to the
// next multiple of 4. When the gap after the bullet is 1-4 columns the
// content starts after it; with 5 or more columns the content indent is
// bullet width + 1 and the extra spaces stay in the content.
function firstContent(bulletIndent, bullet, after) {
  const base = bulletIndent + bullet.length;
  let col = base;
  let k = 0;
  while (k < after.length) {
    const c = after.charCodeAt(k);
    if (c === CC.space) { col++; k++; }
    else if (c === CC.tab) { col += 4 - (col % 4); k++; }
    else break;
  }
  const rest = after.slice(k);
  if (rest.length === 0) return { W: base + 1, content: '' };
  const gap = col - base;
  if (gap >= 5) return { W: base + 1, content: ' '.repeat(gap - 1) + rest };
  return { W: col, content: rest };
}

// Scan a line's leading whitespace: blank means the line holds only spaces
// and tabs, col is the tab-expanded column of the first other character,
// and at is its index.
function leadInfo(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === CC.space) { col++; i++; }
    else if (c === CC.tab) { col += 4 - (col % 4); i++; }
    else break;
  }
  return { blank: i === line.length, col, at: i };
}

// Remove W columns from a line whose leading whitespace expands to `col`
// columns (from leadInfo). The remainder of the leading whitespace stays.
function outdent(line, info, W) {
  if (info.col < W) return null;
  return ' '.repeat(info.col - W) + line.slice(info.at);
}
