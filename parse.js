// A faster drop-in for marked 18.1.3: the same HTML, rendered through
// marked's own Lexer and Parser, but with a fast list tokenizer and
// first-character guards on the inline rules (see
// src/OptimizedTokenizer.js), and one lexer/parser pair reused across
// calls instead of built fresh for every document.

import { Lexer, Parser, getDefaults } from './vendor/marked/marked.esm.js';
import { FastTokenizer } from './src/OptimizedTokenizer.js';

const baseOptions = getDefaults();
const lexer = new Lexer({ ...baseOptions, tokenizer: new FastTokenizer() });
const parser = new Parser({ ...baseOptions });
const lexState = lexer.state;

// Fresh-lexer state, written back before every document so a reused lexer
// behaves exactly like a new one: empty tokens, an empty link table, an
// empty inline queue, and every state flag back to its default.
//
// The tokens array itself is reused (length = 0) instead of reallocated:
// parse() is synchronous and the Parser keeps no reference to the tokens
// once it returns, so nothing can observe the previous document's list.
function resetLexer() {
  lexer.tokens.length = 0;
  lexer.tokens.links = Object.create(null);
  lexer.inlineQueue = [];
  lexState.inLink = false;
  lexState.inRawBlock = false;
  lexState.linkEmitted = false;
  lexState.linkParenPossible = true;
  lexState.top = true;
}

/** The HTML marked 18.1.3 renders for `markdown`, with its defaults. */
export function parse(markdown) {
  resetLexer();
  const tokens = lexer.lex(markdown);
  return parser.parse(tokens);
}
