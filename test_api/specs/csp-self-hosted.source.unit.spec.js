/* eslint-disable no-undef */
// Content-Security-Policy of the self-hosted CE. Nothing in CE loads Google Analytics,
// Google Tag Manager, DoubleClick or a TrustSource SaaS host, so the policy no longer
// allows them: a script that does get injected cannot load from or report to them either.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const helmet = stripComments(read('imports/startup/server/helmet.js'));

function directive(name) {
  const match = helmet.match(new RegExp(name + ':\\s*\\[([\\s\\S]*?)\\]'));
  if (!match) {
    throw new Error(`${name} not found`);
  }
  return match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

describe('helmet CSP', () => {
  it.each(['google-analytics', 'googletagmanager', 'doubleclick', 'analytics.google', 'trustsource.io'])(
    'allows no %s source', (host) => {
      expect(helmet).not.toContain(host);
    });

  it('keeps the sources the app itself needs', () => {
    expect(directive('scriptSrc')).toEqual(['\\\'self\\\'', '\\\'unsafe-inline\\\'']);
    expect(directive('connectSrc')).toEqual(['\\\'self\\\'']);
    expect(directive('imgSrc')).toEqual(['\\\'self\\\'', 'data:']);
    expect(directive('mediaSrc')).toEqual(['\\\'self\\\'', 'data:', 'blob:']);
    expect(directive('workerSrc')).toEqual(['\\\'self\\\'', 'blob:']);
  });

  it('the client loads no analytics or tag-manager script', () => {
    const head = read('client/head.html');
    expect(head).not.toMatch(/googletagmanager|google-analytics|gtag\(/);
  });
});
