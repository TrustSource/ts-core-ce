#!/usr/bin/env node
// Regenerates imports/server/cwe/cwe-catalog.json: the CWE entries the Vulnerability
// Lake's Find CWE page, the CSAF editor and the VEX export name weaknesses from. Taken from
// MITRE's "Research Concepts" view (1000), which lists every weakness.
//
// Usage: node tools/cwe/build-cwe-catalog.mjs
//
// Needs `unzip` on the PATH (MITRE publishes the CSV zipped only). The output is committed;
// the app never fetches CWE data at runtime.

import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import cweCsv from './cweCsv.js';

const SOURCE = 'https://cwe.mitre.org/data/csv/1000.csv.zip';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../imports/server/cwe/cwe-catalog.json');
const MIN_ENTRIES = 900;

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cwe-'));
  try {
    const response = await fetch(SOURCE);
    if (!response.ok) {
      throw new Error(`${SOURCE}: HTTP ${response.status}`);
    }
    const zip = path.join(dir, '1000.csv.zip');
    await writeFile(zip, Buffer.from(await response.arrayBuffer()));
    const csv = execFileSync('unzip', ['-p', zip], {maxBuffer: 64 * 1024 * 1024}).toString('utf8');
    const cwes = cweCsv.toCatalog(cweCsv.parseCsv(csv));
    const count = Object.keys(cwes).length;
    if (count < MIN_ENTRIES) {
      throw new Error(`only ${count} CWE entries parsed, expected at least ${MIN_ENTRIES}`);
    }
    const fetched = new Date().toISOString().slice(0, 10);
    await writeFile(OUT, JSON.stringify({source: SOURCE, fetched, cwes}) + '\n');
    console.log(`wrote ${count} CWE entries to ${path.relative(process.cwd(), OUT)}`);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
