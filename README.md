# marked-fast-subclass

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Hendricontrex/marked-fast-subclass/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Hendricontrex/marked-fast-subclass/reward.svg)](https://make.fun/c/markdown-render-speed-02)

A faster drop-in for [marked](https://github.com/markedjs/marked) 18.1.3,
entered in the [markdown-render-speed-02](https://make.fun/c/markdown-render-speed-02)
competition on [make.fun](https://make.fun).

`parse.js` exports `parse(markdown)`, which returns exactly the HTML that
marked 18.1.3 renders with its default options (GFM on). It runs marked's
own Lexer and Parser, but with two speed-ups in
`src/OptimizedTokenizer.js`:

- a `list()` that scans list lines with `indexOf` instead of `split()`;
- first-character guards on the inline rules (`escape`, `tag`, `link`,
  `reflink`, `emStrong`, `codespan`, `br`, `del`, `autolink`, `url`), so a
  regex is only tried when the current character can start its construct.

`main.ts` reads `/input/cases.json`, renders every case with `parse()`, and
writes `/output/html.json`. The marked source itself is vendored unchanged
under `vendor/marked/` (MIT, see `vendor/marked/LICENSE`).
