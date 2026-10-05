/**
 * Take a consistent, compact copy of the geodata database.
 *
 *   node server/backup-db.mjs /somewhere/geodata.db
 *
 * Copying the file with `cp` while anything has it open produces a database
 * that may be missing whatever is still sitting in the write-ahead log, and
 * the damage is silent — you get a file that opens cleanly and is quietly
 * short of data. `VACUUM INTO` asks SQLite to write the copy itself, which
 * folds in the WAL, skips free pages, and is safe to run against a database
 * the cache server is actively reading.
 *
 * This is how the database travels when it is too big for git: build it once,
 * back it up, hand over the single file.
 */

import process from 'node:process';
import { statSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PATH, stats } from './db.mjs';

const mb = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const target = resolve(process.argv[2] ?? './geodata-backup.db');
const source = DEFAULT_PATH;

if (!existsSync(source)) {
  console.error(`No database at ${source}.`);
  process.exit(1);
}

// VACUUM INTO refuses to overwrite, which is a good default and a poor
// experience for a command people re-run; removing it first is explicit.
if (existsSync(target)) {
  console.log(`Replacing existing ${target}`);
  unlinkSync(target);
}

const db = new DatabaseSync(source, { readOnly: true });
const before = stats(db);

console.log(`Backing up ${source} (${mb(statSync(source).size)})`);
console.log(`  ${before.entries.toLocaleString()} downloads · ${before.features.toLocaleString()} features`);

const started = Date.now();
// The path is interpolated because VACUUM does not accept a bound parameter;
// doubling any quote keeps a path with an apostrophe from ending the literal.
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const copy = new DatabaseSync(target, { readOnly: true });
const after = stats(copy);
copy.close();

if (after.entries !== before.entries) {
  console.error(`\nCopy has ${after.entries} downloads, source had ${before.entries}. Not trusting it.`);
  process.exit(1);
}

console.log(`\nWrote ${target} (${mb(statSync(target).size)}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`Verified ${after.entries.toLocaleString()} downloads · ${after.features.toLocaleString()} features.`);
