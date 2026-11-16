// parse.js — render one Markdown document to HTML with the fast tokenizer.
//
// The public entry point for this entry: parse(markdown) returns exactly
// what marked 18.1.3 renders with its default options (GFM on). The only
// difference from stock marked is the tokenizer, which is a subclass with
// a faster list rule and first-character guards on the inline rules. The
// lexer and parser are marked's own, so the output is byte-identical.

import { Lexer, Parser, getDefaults } from './vendor/marked/marked.esm.js';
import { FastTokenizer } from './src/OptimizedTokenizer.js';

// One lexer/parser pair, reused across cases. Building a fresh tokenizer,
// lexer, and parser per case is pure overhead: the lexer holds no state
// between documents once its token list, link table, inline queue, and
// flags are cleared, and the parser is stateless given its tokens.
const options = { ...getDefaults(), gfm: true };
const fast = new FastTokenizer(options);
options.tokenizer = fast;
const lexer = new Lexer(options);
const parser = new Parser(options);

export function parse(markdown) {
  lexer.tokens.length = 0;
  lexer.tokens.links = Object.create(null);
  lexer.inlineQueue.length = 0;
  lexer.state.inLink = false;
  lexer.state.inRawBlock = false;
  lexer.state.top = true;
  const tokens = lexer.lex(markdown);
  return parser.parse(tokens);
}
