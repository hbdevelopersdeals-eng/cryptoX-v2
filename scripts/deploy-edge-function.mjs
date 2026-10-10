/* Builds the deploy_edge_function payload for one function. Run per function. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fn = process.argv[2];
if (!fn) { console.error('usage: node __deploy-payload.mjs <fn-dir> <verify_jwt true|false>'); process.exit(1); }
const verifyJwt = process.argv[3] === 'true';

const files = ['index.ts', 'handler.js'].map((name) => ({
  name,
  content: readFileSync(`supabase/functions/${fn}/${name}`, 'utf8')
}));

const payload = {
  project_id: 'bvyiqinyakxlefaeomoj',
  name: fn,
  entrypoint_path: 'index.ts',
  verify_jwt: verifyJwt,
  files
};

const path = join(tmpdir(), `cx_deploy_${fn}.json`);
writeFileSync(path, JSON.stringify(payload), 'utf8');
console.log(`${fn}: ${files.length} files, verify_jwt=${verifyJwt} -> ${path}`);
