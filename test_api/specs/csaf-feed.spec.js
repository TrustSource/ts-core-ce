/* eslint-disable no-undef */
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');

const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
// Optional seeded fixtures (set in CI/local to enable filtering assertions):
//   CSAF_KEY_WHITE       - a key scoped to [WHITE]
//   CSAF_KEY_AMBER_WHITE - a key scoped to [AMBER, WHITE]
//   CSAF_AMBER_DOC_ID    - _id of a published AMBER document in that company
const CSAF_KEY_WHITE = process.env.CSAF_KEY_WHITE;
const CSAF_KEY_AMBER_WHITE = process.env.CSAF_KEY_AMBER_WHITE;
const CSAF_AMBER_DOC_ID = process.env.CSAF_AMBER_DOC_ID;

const feed = (key) => `${BASE}/compliance/csaf/${key}/documents`;

describe(`${BASE}/compliance/csaf/:key/documents`, () => {
  //
  //   NO-SEED behaviors (always run)
  //
  it('404 GET with unknown key', async () => {
    await supertest(ROOT_URL).get(feed('unknown-key-xyz'))
      .expect(StatusCodes.NOT_FOUND);
  });

  it('405 DELETE', async () => {
    await supertest(ROOT_URL).delete(feed('unknown-key-xyz'))
      .expect(StatusCodes.METHOD_NOT_ALLOWED);
  });

  it('200 OPTIONS preflight', async () => {
    await supertest(ROOT_URL).options(feed('any'))
      .expect(StatusCodes.OK);
  });

  it('404 GET document with unknown key', async () => {
    await supertest(ROOT_URL).get(`${feed('unknown-key-xyz')}/someid`)
      .expect(StatusCodes.NOT_FOUND);
  });

  //
  //   SEEDED behaviors (TLP filtering)
  //
  const maybe = (CSAF_KEY_WHITE && CSAF_KEY_AMBER_WHITE) ? describe : describe.skip;
  maybe('TLP filtering (seeded)', () => {
    it('WHITE key lists only WHITE documents', async () => {
      await supertest(ROOT_URL).get(feed(CSAF_KEY_WHITE))
        .expect(StatusCodes.OK)
        .then((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          res.body.forEach((d) => expect(d.tlp).toBe('WHITE'));
        });
    });

    it('AMBER+WHITE key lists AMBER and WHITE documents', async () => {
      await supertest(ROOT_URL).get(feed(CSAF_KEY_AMBER_WHITE))
        .expect(StatusCodes.OK)
        .then((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          res.body.forEach((d) => expect(['AMBER', 'WHITE']).toContain(d.tlp));
        });
    });

    (CSAF_AMBER_DOC_ID ? it : it.skip)('WHITE key gets 404 for an AMBER document', async () => {
      await supertest(ROOT_URL).get(`${feed(CSAF_KEY_WHITE)}/${CSAF_AMBER_DOC_ID}`)
        .expect(StatusCodes.NOT_FOUND);
    });

    (CSAF_AMBER_DOC_ID ? it : it.skip)('AMBER+WHITE key gets the AMBER document', async () => {
      await supertest(ROOT_URL).get(`${feed(CSAF_KEY_AMBER_WHITE)}/${CSAF_AMBER_DOC_ID}`)
        .expect(StatusCodes.OK)
        .then((res) => {
          expect(res.body).toHaveProperty('document');
        });
    });
  });
});
