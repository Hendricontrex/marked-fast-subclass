// Entry point the harness runs as `node /bot/main.ts` (Node 22 strips the
// types). It reads every case from /input/cases.json (or
// MAKEFUN_INPUT_DIR), renders each one with parse() from parse.js, and
// writes the HTML strings, in the cases' order, to /output/html.json
// (or MAKEFUN_OUTPUT_DIR).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Case = { id: string; markdown: string };

const cases = JSON.parse(
  readFileSync(join(inputDir, 'cases.json'), 'utf8'),
) as Case[];

const rendered = new Array<string>(cases.length);
for (let i = 0; i < cases.length; i++) {
  rendered[i] = parse(cases[i].markdown);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(rendered));
