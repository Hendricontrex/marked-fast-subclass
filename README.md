# marked-fast-subclass

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Hendricontrex/marked-fast-subclass/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Hendricontrex/marked-fast-subclass/reward.svg)](https://make.fun/c/markdown-render-speed-02)

A fast drop-in for [marked](https://github.com/markedjs/marked) 18.1.3, built for the
[make.fun markdown-render-speed-02](https://make.fun/c/markdown-render-speed-02) competition.
It renders Markdown to exactly the same HTML as stock marked with its default options
(GFM on) — only faster.

## How it is faster

`src/OptimizedTokenizer.js` subclasses marked's `Tokenizer` with two optimizations
that keep the output byte-identical:

1. **Fast list tokenizer.** Marked's list rule only matches the first line of a list,
   so the rest is a line scan. Instead of running a sequence of separate begin-rule
   tests per line, this one walks the source with `indexOf`, one line at a time, and
   decides per line — from the first character — whether it starts a new item,
   continues the current one (indented), continues it lazily, is a blank line, or
   ends the list. Lines are never split: outdenting works on the line slice in
   place. Tabs are expanded to tab stops of 4, blank lines and loose-vs-tight
   lists are tracked exactly as marked does, task checkboxes are recognised, and
   lazy paragraph continuations follow marked's interruption rules.

2. **First-character guards on the inline rules.** Every inline rule's pattern is
   anchored at the start of the remaining source and needs a specific trigger
   character, so when the first character cannot match the rule returns early
   without running the pattern at all: `\` for escapes, `<` for tags and autolinks,
   `[` or `!` for links and reference links, `*` or `_` for emphasis, `` ` `` for
   code spans, a space or `\` for hard breaks, `~` for strikethrough, and a letter,
   digit, or `.`/`_`/`+`/`-` for URLs.

## Layout

- `parse.js` — the entry point: `parse(markdown)` returns the HTML.
- `main.ts` — the driver the harness runs: reads the cases, renders each one
  alone, writes the HTML array.
- `src/OptimizedTokenizer.js` — the fast tokenizer subclass.
- `vendor/marked/marked.esm.js` — the vendored marked library (untouched).

## Check

The practice set grades locally with the make.fun kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver process --worktree
```

All 720 practice cases must render byte-identical to marked, and faster.
