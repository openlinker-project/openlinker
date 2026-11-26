/**
 * Runs the repo's own offline specs for the `auto` points of the Amazon
 * checklist and caches the result for the run (so three regions run each
 * command once).
 *
 * @module support
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUN_DIR } from './amazon';

export interface AutoResult {
  ok: boolean;
  command: string;
  tail: string;
}

const ROOT = resolve(RUN_DIR, '../../../..');

/** `file` + `args` run in `cwd`; `docker:<image>` runs `args[0]` as a shell command inside that image at /app. */
export async function runAuto(key: string, cwd: string, args: string[], via: 'host' | 'docker' = 'host'): Promise<AutoResult> {
  mkdirSync(RUN_DIR, { recursive: true });
  const cache = resolve(RUN_DIR, `auto-${key}.json`);
  if (existsSync(cache) && Date.now() - JSON.parse(readFileSync(cache, 'utf8')).at < 30 * 60 * 1000) {
    return JSON.parse(readFileSync(cache, 'utf8')).result as AutoResult;
  }
  const result = await new Promise<AutoResult>((done) => {
    const [file, fileArgs] =
      via === 'docker'
        ? ['docker', ['run', '--rm', process.env.AMAZON_AUTO_IMAGE ?? 'olamz-migrate', 'sh', '-c', `cd /app && ${args[0]}`]]
        : ['pnpm', args];
    execFile(file, fileArgs, { cwd: resolve(ROOT, cwd), maxBuffer: 20 * 1024 * 1024, timeout: 900_000 }, (error, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      const tail = out.split('\n').filter((l) => /Tests:|Test Suites:|Test Files|Tests |FAIL|failed/.test(l)).slice(-8).join('\n');
      done({ ok: error === null, command: `${String(file)} ${(fileArgs).join(' ')}`, tail });
    });
  });
  writeFileSync(cache, JSON.stringify({ at: Date.now(), result }));
  return result;
}
