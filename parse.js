// parse.js — render one Markdown document to HTML with the fast tokenizer.
//
// The public entry point for this entry: parse(markdown) returns exactly
// what marked 18.1.3 renders with its default options (GFM on). The only
// difference from stock marked is the tokenizer, which is a subclass with
// a faster list rule and first-character guards on the inline rules. The
// lexer and parser are marked's own, so the output is byte-identical.

import { Lexer, Parser, getDefaults } from './vendor/marked/marked.esm.js';
import { FastTokenizer } from './src/OptimizedTokenizer.js';

export function parse(markdown) {
  const options = { ...getDefaults(), gfm: true };
  const fast = new FastTokenizer(options);
  options.tokenizer = fast;
  const tokens = new Lexer(options).lex(markdown);
  return new Parser(options).parse(tokens);
}
