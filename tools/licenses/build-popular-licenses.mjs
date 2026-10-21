#!/usr/bin/env node
// Regenerates imports/server/licenses/popular-licenses.json: the licenses a fresh
// Community Edition install is seeded with, taken from the SPDX license list.
//
// Usage: node tools/licenses/build-popular-licenses.mjs
//
// The output is committed; the app never fetches license data at runtime.

import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Pinned to a release tag rather than `main`, so a re-run months later reads the same
// data `main` had on the day this was pinned, not whatever the license list has moved
// on to. Bump SPDX_TAG deliberately (check
// https://api.github.com/repos/spdx/license-list-data/releases/latest) when the seed
// needs refreshing, and re-run this script.
const SPDX_TAG = 'v3.28.0';

const IDS = [
  'MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause',
  'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-2.0-or-later', 'GPL-2.0-with-classpath-exception',
  'EPL-1.0', 'MPL-2.0', 'EPL-2.0', 'LGPL-3.0-only', 'AGPL-3.0-only', 'CC0-1.0', 'Unlicense',
  'SSPL-1.0'
];

// SPDX ships this one with a literal placeholder line instead of the GPL v2 text (its
// "exception" records only carry the exception clause, and expect a reader to already
// have the base license). We stitch the real GPL-2.0-only text in ourselves.
const CLASSPATH_ID = 'GPL-2.0-with-classpath-exception';
const PLACEHOLDER_LINE = /insert GPL v2 license text here/i;

const SOURCE = 'https://github.com/spdx/license-list-data';
const BASE = `https://raw.githubusercontent.com/spdx/license-list-data/${SPDX_TAG}/json/`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)),
  '../../imports/server/licenses/popular-licenses.json');

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeText(raw) {
  return raw.replace(/\r\n/g, '\n').trim();
}

// Removes the placeholder line SPDX ships in the classpath-exception record, plus any
// blank lines directly after it, leaving only the actual exception clause.
function stripPlaceholder(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const placeholderIndex = lines.findIndex((line) => PLACEHOLDER_LINE.test(line));
  if (placeholderIndex === -1) {
    throw new Error(`${CLASSPATH_ID}: expected placeholder line is gone - upstream text ` +
      'may have changed; re-check before trusting this script\'s stitch');
  }
  let start = placeholderIndex + 1;
  while (start < lines.length && lines[start].trim() === '') {
    start++;
  }
  return lines.slice(start).join('\n').trim();
}

async function buildClasspathText(details) {
  const gplOnly = await fetchJson(BASE + 'details/GPL-2.0-only.json');
  if (gplOnly.licenseId !== 'GPL-2.0-only' || !gplOnly.licenseText) {
    throw new Error('GPL-2.0-only: incomplete SPDX record (needed to fill in the ' +
      `${CLASSPATH_ID} placeholder)`);
  }
  const gplOnlyText = normalizeText(gplOnly.licenseText);
  const exceptionText = stripPlaceholder(details.licenseText);
  return `${gplOnlyText}\n\n${exceptionText}`.trim() + '\n';
}

const index = await fetchJson(BASE + 'licenses.json');
const known = new Set(index.licenses.map((l) => l.licenseId));

const licenses = [];
for (const id of IDS) {
  if (!known.has(id)) {
    throw new Error(`${id}: not in SPDX license list ${index.licenseListVersion}`);
  }
  const details = await fetchJson(BASE + 'details/' + encodeURIComponent(id) + '.json');
  if (details.licenseId !== id || !details.name || !details.licenseText) {
    throw new Error(`${id}: incomplete SPDX record`);
  }
  const homepage = (details.seeAlso || []).find((url) => /^https?:\/\/\S+$/.test(url));
  const text = id === CLASSPATH_ID
    ? await buildClasspathText(details)
    : normalizeText(details.licenseText) + '\n';
  licenses.push({
    key: id,
    name: details.name,
    url: homepage || `https://spdx.org/licenses/${id}.html`,
    text
  });
}

const placeholders = licenses.filter((license) => PLACEHOLDER_LINE.test(license.text));
if (placeholders.length) {
  throw new Error('placeholder license text slipped through for: ' +
    placeholders.map((license) => license.key).join(', '));
}

await mkdir(path.dirname(OUT), {recursive: true});
await writeFile(OUT, JSON.stringify(
  {source: SOURCE, sourceTag: SPDX_TAG, licenseListVersion: index.licenseListVersion, licenses},
  null, 2) + '\n');
console.log(`Wrote ${licenses.length} licenses (SPDX ${index.licenseListVersion}, tag ${SPDX_TAG}) to ${path.relative(process.cwd(), OUT)}`);
