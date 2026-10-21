/* eslint-disable no-undef */
const {
  extractTlp,
  isTlpAccessible,
  buildFeedQuery,
  buildFeedDocumentQuery,
  providerTlpDirectory
} = require('../../imports/lib/csaf/feedAccess');

describe('csaf feedAccess helpers', () => {
  describe('extractTlp', () => {
    it('reads the label from a CSAF document object', () => {
      const doc = {document: {distribution: {tlp: {label: 'AMBER'}}}};
      expect(extractTlp(doc)).toBe('AMBER');
    });
    it('parses a JSON string', () => {
      const str = JSON.stringify({document: {distribution: {tlp: {label: 'white'}}}});
      expect(extractTlp(str)).toBe('WHITE'); // normalized to upper-case
    });
    it('returns undefined when the label is missing', () => {
      expect(extractTlp({document: {}})).toBeUndefined();
      expect(extractTlp('not json')).toBeUndefined();
      expect(extractTlp(null)).toBeUndefined();
    });
  });

  describe('isTlpAccessible', () => {
    const key = {tlpLevels: ['AMBER', 'WHITE']};
    it('true when the doc tlp is in the key set', () => {
      expect(isTlpAccessible('WHITE', key)).toBe(true);
      expect(isTlpAccessible('AMBER', key)).toBe(true);
    });
    it('false when the doc tlp is not in the key set', () => {
      expect(isTlpAccessible('RED', key)).toBe(false);
      expect(isTlpAccessible('GREEN', key)).toBe(false);
    });
    it('false for missing tlp or empty key set', () => {
      expect(isTlpAccessible(undefined, key)).toBe(false);
      expect(isTlpAccessible('WHITE', {tlpLevels: []})).toBe(false);
      expect(isTlpAccessible('WHITE', {})).toBe(false);
    });
  });

  // Just enough of Mongo's query matching for the feed selectors, so the specs
  // below check which stored documents a selector admits, not only its shape.
  function matches(doc, query) {
    return Object.keys(query).every((field) => {
      const cond = query[field];
      const value = doc[field];
      if (!cond || typeof cond !== 'object' || cond instanceof Date) {
        return value === cond;
      }
      return Object.keys(cond).every((op) => {
        switch (op) {
          case '$exists': return (value !== undefined) === cond.$exists;
          case '$type': return cond.$type === 'date' ? value instanceof Date : typeof value === cond.$type;
          case '$in': return cond.$in.indexOf(value) > -1;
          default: throw new Error(`matches(): unsupported operator ${op}`);
        }
      });
    });
  }

  // The stored states a CSAF document goes through (create.js, ts-csaf.js).
  const base = {_id: 'csaf-1', companyId: 'company-1', tlp: 'WHITE'};
  const draft = Object.assign({}, base, {status: 'DRAFT'});
  const failedFirstUpload = Object.assign({}, base, {status: 'FAILED', failed: new Date()});
  const published = Object.assign({}, base, {status: 'PUBLISHED', published: new Date()});
  const failedRepublish = Object.assign({}, published, {status: 'FAILED', failed: new Date()});
  const removedDoc = Object.assign({}, published, {removed: new Date()});
  const otherTenant = Object.assign({}, published, {companyId: 'company-2'});

  describe('buildFeedQuery', () => {
    it('scopes by company, not-removed, published only, and tlp set', () => {
      const q = buildFeedQuery('company-1', {tlpLevels: ['WHITE']});
      expect(q).toEqual({
        companyId: 'company-1',
        removed: {$exists: false},
        published: {$type: 'date'},
        tlp: {$in: ['WHITE']}
      });
    });

    it('keeps a published advisory listed after a failed re-publish', () => {
      const q = buildFeedQuery('company-1', {tlpLevels: ['WHITE']});
      expect(matches(published, q)).toBe(true);
      expect(matches(failedRepublish, q)).toBe(true);
    });

    it('never lists drafts, failed first uploads, removed or other tenants\' documents', () => {
      const q = buildFeedQuery('company-1', {tlpLevels: ['WHITE']});
      [draft, failedFirstUpload, removedDoc, otherTenant].forEach((doc) => {
        expect(matches(doc, q)).toBe(false);
      });
      // A status alone, without a successful upload, does not make a document published.
      expect(matches(Object.assign({}, base, {status: 'PUBLISHED'}), q)).toBe(false);
    });

    it('lists only the TLP levels the key permits', () => {
      expect(matches(published, buildFeedQuery('company-1', {tlpLevels: ['AMBER']}))).toBe(false);
    });
  });

  describe('buildFeedDocumentQuery', () => {
    it('selects one document by id with the same published rule as the list', () => {
      const q = buildFeedDocumentQuery('company-1', 'csaf-1');
      expect(q).toEqual({
        _id: 'csaf-1',
        companyId: 'company-1',
        removed: {$exists: false},
        published: {$type: 'date'}
      });
      expect(matches(published, q)).toBe(true);
      expect(matches(failedRepublish, q)).toBe(true);
      [draft, failedFirstUpload, removedDoc, otherTenant].forEach((doc) => {
        expect(matches(doc, q)).toBe(false);
      });
    });
  });

  describe('csaf-feed.js', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../imports/server/rest-api/csaf-feed.js'), 'utf8');

    it('selects the list and the document with the shared feed queries', () => {
      expect(src).toMatch(/buildFeedQuery\(access\.companyId, access\.csafKey\)/);
      expect(src).toMatch(/CSAF\.findOneAsync\(buildFeedDocumentQuery\(access\.companyId, params\.id\)\)/);
      // The status alone is not the published rule (a failed re-publish keeps `published`).
      expect(src).not.toMatch(/status: 'PUBLISHED'/);
    });
  });

  describe('providerTlpDirectory', () => {
    const doc = (label) => ({document: {distribution: {tlp: {label}}}});
    it('uses the lower-case TLP label', () => {
      expect(providerTlpDirectory(doc('GREEN'))).toBe('green');
      expect(providerTlpDirectory(doc('amber'))).toBe('amber');
      expect(providerTlpDirectory(JSON.stringify(doc('RED')))).toBe('red');
    });
    it('falls back to white without a label', () => {
      expect(providerTlpDirectory({document: {}})).toBe('white');
    });
  });
});
