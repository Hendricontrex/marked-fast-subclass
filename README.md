# marked-fast — a faster drop-in for marked 18.1.3

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Hendricontrex/marked-fast-subclass/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Hendricontrex/marked-fast-subclass/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

`parse(markdown)` returns exactly the HTML [marked 18.1.3](https://github.com/markedjs/marked) renders with its defaults (GFM on, async off) — but faster. The marked library is vendored untouched (`vendor/marked/marked.esm.js`); speed comes from a subclass (`src/OptimizedTokenizer.js`):

- **List tokenizer uses one combined "end of item" regex** instead of six separate tests per line, and `indexOf` instead of `split()` for line ends, so sliced strings are never flattened per line.
- **Inline tokenizer methods guard on the first character**, skipping rules whose `^`-anchored regex cannot match.

## Entry

- `main.ts` — the harness driver: reads `/input/cases.json`, renders each case with `parse()`, writes `/output/html.json`.
- `parse.js` — exports `parse(markdown)`.
- `src/OptimizedTokenizer.js` — the optimized Tokenizer subclass.
- `vendor/marked/marked.esm.js` — marked 18.1.3, vendored unchanged (MIT).

## License

MIT. marked is © marked.js, MIT — see `LICENSE`.
