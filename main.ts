// main.ts — driver: read the cases, render each one alone, write the HTML.
//
// The harness runs this as `node /bot/main.ts`. Cases come from
// $MAKEFUN_INPUT_DIR/cases.json (default /input); the rendered HTML goes
// to $MAKEFUN_OUTPUT_DIR/html.json (default /output), one string per case,
// in order. Every case is rendered on its own, exactly as the scorer
// expects, so no state is shared between cases.

import * as fs from 'node:fs';
import { parse as renderMarkdown } from './parse.js';

type CaseDoc = { markdown: string };

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const payload = fs.readFileSync(`${inDir}/cases.json`, 'utf8');
const docs: CaseDoc[] = JSON.parse(payload);
const rendered = docs.map((doc) => renderMarkdown(doc.markdown));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/html.json`, JSON.stringify(rendered));
