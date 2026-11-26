/**
 * The PR author's checkpoint register (C/S/P/I/O/N/F/W/M/R/U ids) against
 * what this branch's fake-server run observed. Appends a table to
 * docs/plans/amazon-e2e-results.md: id, his status, our result, screenshot.
 *
 *   node apps/e2e/scripts/amazon-author-table.mjs
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHOR_ROWS, AUTHOR_MAP } from './amazon-author-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const results = new Map();
const f = resolve(root, 'apps/e2e/local-e2e-runs/amazon/results.jsonl');
if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const d = JSON.parse(l); results.set(`${d.region}:${d.point}`, d); }
const author = new Map();
const af = resolve(root, 'apps/e2e/local-e2e-runs/amazon/author-results.jsonl');
if (existsSync(af)) for (const l of readFileSync(af, 'utf8').split('\n').filter(Boolean)) { const d = JSON.parse(l); author.set(`${d.project}:${d.id}`, d); }
const NEEDS_REAL = new Set(['C05']);
const rows = AUTHOR_ROWS.map(([id, title, status]) => {
  const refs = AUTHOR_MAP[id] ?? ['none:not mapped'];
  let ours = '';
  let shot = '';
  if (NEEDS_REAL.has(id) || refs[0] === 'real') ours = 'needs real account (pnpm amazon:probe does not exist on this branch)';
  else if (refs[0].startsWith('none:')) ours = `not run: ${refs[0].slice(5)}`;
  else {
    const parts = [];
    for (const r of refs) {
      if (r.startsWith('[')) {
        const hit = ['amazon-eu', 'amazon-na', 'amazon-fe'].map((p) => author.get(`${p}:${r.slice(1, -1)}`)).find(Boolean);
        parts.push(hit ? `${r} ${hit.result}` : `${r} not run`);
        shot ||= hit?.screenshot ?? '';
      } else {
        const n = Number(r.slice(1));
        const cells = ['eu', 'na', 'fe'].map((reg) => results.get(`${reg}:${n}`)).filter(Boolean);
        parts.push(cells.length === 0 ? `${r} not run` : `${r} ${cells.every((c) => c.result === 'pass') ? 'pass' : 'FAIL'}${cells.some((c) => /simulated/i.test(c.note)) ? ' (simulated)' : ''}`);
        shot ||= cells[0]?.screenshot ?? '';
      }
    }
    ours = parts.join(', ');
  }
  return `| ${id} | ${title.replace(/\|/g, '/')} | ${status} | ${ours} | ${shot ? shot.replace(root + '/', '') : ''} |`;
});
const table = `\n\n## The PR author's checkpoint register\n\nHis ids (C, S, P, I, O, N, F, W, M, R, U) with his status from the real-sandbox run of 18 Nov 2026, and what this branch shows through the fake server. "Sandbox" rows are the ones the real sandbox could not answer; the fake can. A row marked needs real account cannot be answered by any local run. Simulated passes prove OpenLinker's side only. The second R series (R01-R03) is suffixed b.\n\n| id | his scenario | his status | our result | screenshot |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
const out = resolve(root, 'docs/plans/amazon-e2e-results.md');
let current = readFileSync(out, 'utf8');
current = current.split("\n\n## The PR author's checkpoint register")[0];
writeFileSync(out, current + table);
console.log(`author rows: ${rows.length}`);
