import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { appBaseUrl, appLink, DEFAULT_APP_URL } from '../../../analysis/services/appUrl.js';

// ts-app hands every service APP_URL (this installation's ROOT_URL, ending in '/').
describe('appUrl', () => {
  it('keeps an APP_URL that ends with a slash', () => {
    assert.equal(appBaseUrl('https://ts.example.org/'), 'https://ts.example.org/');
  });

  it('adds the trailing slash an APP_URL is missing', () => {
    assert.equal(appBaseUrl('https://ts.example.org'), 'https://ts.example.org/');
  });

  it('falls back to http://localhost:3000/ when APP_URL is missing or empty', () => {
    assert.equal(DEFAULT_APP_URL, 'http://localhost:3000/');
    [undefined, null, '', '   ', 42, {}].forEach((value) => {
      assert.equal(appBaseUrl(value), DEFAULT_APP_URL);
    });
  });

  it('joins a path without a double slash', () => {
    assert.equal(appLink('https://ts.example.org/', 'projects/P1'), 'https://ts.example.org/projects/P1');
    assert.equal(appLink('https://ts.example.org/', '/projects/P1'), 'https://ts.example.org/projects/P1');
    assert.equal(appLink('https://ts.example.org/sub/', 'vulnerability_lake'), 'https://ts.example.org/sub/vulnerability_lake');
  });
});
