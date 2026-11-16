import { Tokenizer } from '../vendor/marked/marked.esm.js';

// Expand tabs in `str` to spaces, tracking the column from `col`.
// Mirrors marked's own tab expansion: a tab jumps to the next multiple of 4.
function expandTabs(str, col = 0) {
  let out = '';
  for (const ch of str) {
    if (ch === '\t') {
      const n = 4 - (col % 4);
      out += ' '.repeat(n);
      col += n;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

// First line of `s` (without its trailing newline), found with indexOf
// instead of split(), which avoids allocating an array per line.
function firstLine(s) {
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

// A fast list tokenizer: same tokens as marked's Tokenizer.list, but the
// line scan walks the string with indexOf instead of splitting it, and the
// item text is built with plain string appends.
export class FastTokenizer extends Tokenizer {
  list(src) {
    const head = this.rules.block.list.exec(src);
    if (!head) return;
    const other = this.rules.other;
    const block = this.rules.block;
    let rest = src;
    const used = () => src.length - rest.length;
    const bullet = head[1].trim();
    const ordered = bullet.length > 1;
    const out = {
      type: 'list',
      raw: '',
      ordered,
      start: ordered ? +bullet.slice(0, -1) : '',
      loose: false,
      items: [],
    };
    let marker = ordered ? `\\d{1,9}\\${bullet.slice(-1)}` : `\\${bullet}`;
    if (this.options.pedantic) marker = ordered ? marker : '[*+-]';
    const itemRe = other.listItemRegex(marker);
    let blankPending = false;

    while (rest) {
      const m = itemRe.exec(rest);
      if (!m || block.hr.test(rest)) break;
      const itemStart = used();
      rest = rest.substring(m[0].length);
      const afterBullet = m[2];
      const first = firstLine(afterBullet);
      const bulletLen = m[1].length;
      const body = this.options.pedantic
        ? expandTabs(first, bulletLen)
        : first.replace(other.leadingSpaceTab, (v) => expandTabs(v, bulletLen));
      let next = firstLine(rest);
      let emptyFirst = !body.trim();
      let indent;
      let text = '';
      if (this.options.pedantic) {
        indent = 2;
        text = body.trimStart();
      } else if (emptyFirst) {
        indent = bulletLen + 1;
      } else {
        indent = body.search(other.nonSpaceChar);
        if (indent > 4) indent = 1;
        text = body.slice(indent);
        indent += bulletLen;
      }
      let blankItem = false;
      if (emptyFirst && other.blankLine.test(next)) {
        rest = rest.substring(next.length + 1);
        blankItem = true;
      }
      if (!blankItem) {
        const nextBullet = other.nextBulletRegex(indent);
        const hrRe = other.hrRegex(indent);
        const fenceRe = other.fencesBeginRegex(indent);
        const headRe = this.options.pedantic
          ? other.pedanticHeadingBeginRegex(indent)
          : other.headingBeginRegex(indent);
        const htmlRe = other.htmlBeginRegex(indent);
        const bqRe = other.blockquoteBeginRegex(indent);
        let cur = body;
        while (rest) {
          const nl = rest.indexOf('\n');
          const line = nl === -1 ? rest : rest.slice(0, nl);
          next = line;
          let expanded;
          if (this.options.pedantic) {
            next = next.replace(other.listReplaceNesting, '  ');
            expanded = next;
          } else {
            expanded = next.replace(other.leadingSpaceTab, (v) => expandTabs(v));
          }
          if (
            fenceRe.test(next) || headRe.test(next) || htmlRe.test(next) ||
            bqRe.test(next) || nextBullet.test(next) || hrRe.test(next)
          ) break;
          if (expanded.search(other.nonSpaceChar) >= indent || !next.trim()) {
            text += '\n' + expanded.slice(indent);
          } else {
            if (
              emptyFirst ||
              cur.replace(other.tabCharGlobal, '    ').search(other.nonSpaceChar) >= 4 ||
              fenceRe.test(cur) || headRe.test(cur) || htmlRe.test(cur) || hrRe.test(cur)
            ) break;
            const setext = !this.options.pedantic &&
              /^ {0,3}(?:=+|-+) *$/.test(next) &&
              block.lheading.test(`${cur}\n${next}`)
              ? `    ${expanded.replace(/^ {0,3}/, '')}`
              : next;
            text += '\n' + setext;
          }
          emptyFirst = !next.trim();
          rest = nl === -1 ? '' : rest.substring(nl + 1);
          cur = expanded.slice(indent);
        }
      }
      const raw = src.slice(itemStart, used());
      if (!out.loose) {
        if (blankPending) out.loose = true;
        else if (other.doubleBlankLine.test(raw)) blankPending = true;
      }
      out.items.push({
        type: 'list_item',
        raw,
        task: !!this.options.gfm && other.listIsTask.test(text),
        loose: false,
        text,
        tokens: [],
      });
    }

    const last = out.items.at(-1);
    if (!last) return;
    last.raw = last.raw.trimEnd();
    last.text = last.text.trimEnd();
    out.raw = src.slice(0, used()).trimEnd();

    // Re-lex each item's text so its tokens are filled in, and decide
    // looseness exactly as marked does: a list is loose when any item's
    // re-lexed tokens contain a space token spanning a blank line.
    for (const item of out.items) {
      this.lexer.state.top = false;
      item.tokens = this.lexer.blockTokens(item.text, []);
      if (!out.loose) {
        const spaces = item.tokens.filter((t) => t.type === 'space');
        out.loose = spaces.length > 0 &&
          spaces.some((t) => other.anyLine.test(t.raw));
      }
    }

    // Task list items: strip the "[ ]" / "[x]" marker from the item text
    // and its first token, patch any queued inline copy, and prepend a
    // checkbox token where marked puts it.
    for (const item of out.items) {
      const first = item.tokens[0];
      if (item.task && (first?.type === 'text' || first?.type === 'paragraph')) {
        item.text = item.text.replace(other.listReplaceTask, '');
        first.raw = first.raw.replace(other.listReplaceTask, '');
        first.text = first.text.replace(other.listReplaceTask, '');
        for (let q = this.lexer.inlineQueue.length - 1; q >= 0; q--) {
          if (other.listIsTask.test(this.lexer.inlineQueue[q].src)) {
            this.lexer.inlineQueue[q].src =
              this.lexer.inlineQueue[q].src.replace(other.listReplaceTask, '');
            break;
          }
        }
        const check = other.listTaskCheckbox.exec(item.raw);
        if (check) {
          const box = {
            type: 'checkbox',
            raw: check[0] + ' ',
            checked: check[0] !== '[ ]',
          };
          item.checked = box.checked;
          if (out.loose) {
            if (
              item.tokens[0] &&
              ['paragraph', 'text'].includes(item.tokens[0].type) &&
              'tokens' in item.tokens[0] && item.tokens[0].tokens
            ) {
              item.tokens[0].raw = box.raw + item.tokens[0].raw;
              item.tokens[0].text = box.raw + item.tokens[0].text;
              item.tokens[0].tokens.unshift(box);
            } else {
              item.tokens.unshift({
                type: 'paragraph',
                raw: box.raw,
                text: box.raw,
                tokens: [box],
              });
            }
          } else {
            item.tokens.unshift(box);
          }
        }
      } else if (item.task) {
        item.task = false;
      }
    }

    if (out.loose) {
      for (const item of out.items) {
        item.loose = true;
        for (const tok of item.tokens) {
          if (tok.type === 'text') tok.type = 'paragraph';
        }
      }
    }
    return out;
  }

  // Inline rules below: each one bails out fast when the first character
  // cannot start its construct, so the dispatch never pays for a regex
  // that cannot match. Every guard is exact: a construct's regex can only
  // match when the guard passes.
  escape(src) {
    if (src.charCodeAt(0) !== 92) return; // backslash
    return super.escape(src);
  }

  tag(src) {
    if (src.charCodeAt(0) !== 60) return; // <
    return super.tag(src);
  }

  link(src) {
    const c = src.charCodeAt(0);
    if (c !== 91 && c !== 33) return; // [ or !
    return super.link(src);
  }

  reflink(src, links) {
    const c = src.charCodeAt(0);
    if (c !== 91 && c !== 33) return; // [ or !
    return super.reflink(src, links);
  }

  emStrong(src, prevChar, state) {
    const c = src.charCodeAt(0);
    if (c !== 42 && c !== 95) return; // * or _
    return super.emStrong(src, prevChar, state);
  }

  codespan(src) {
    if (src.charCodeAt(0) !== 96) return; // backtick
    return super.codespan(src);
  }

  br(src) {
    const c = src.charCodeAt(0);
    if (c !== 32 && c !== 92) return; // space or backslash
    return super.br(src);
  }

  del(src, prevChar, state) {
    if (src.charCodeAt(0) !== 126) return; // ~
    return super.del(src, prevChar, state);
  }

  autolink(src) {
    if (src.charCodeAt(0) !== 60) return; // <
    return super.autolink(src);
  }

  url(src) {
    // A URL starts with a letter (scheme or www.); an email address starts
    // with a letter, a digit, or one of the local-part punctuation marks.
    // Anything else cannot match, so skip the regex entirely.
    const c = src.charCodeAt(0);
    if (
      (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    ) return super.url(src);
    if ('.!#$%&\'*+/=?^_`{|}~-'.includes(src[0])) return super.url(src);
    return;
  }
}
