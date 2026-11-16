// Optimized drop-in for marked 18.1.3: parse(markdown) returns exactly the
// HTML marked renders with its defaults (GFM on, async off), faster.
// The marked library is vendored untouched (vendor/marked/marked.esm.js);
// speed comes from OptimizedTokenizer (src/OptimizedTokenizer.js), a
// subclass that overrides list() with one combined "end of item" regex per
// line plus indexOf() line ends, and guards the inline methods with a
// first-character check so rules that cannot match are skipped.
import { Marked } from './vendor/marked/marked.esm.js';
import { OptimizedTokenizer } from './src/OptimizedTokenizer.js';

const tokenizer = new OptimizedTokenizer();
const marked = new Marked();
marked.setOptions({ tokenizer });

/** The HTML marked renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
    return marked.parse(markdown);
}
