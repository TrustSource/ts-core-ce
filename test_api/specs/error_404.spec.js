/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;

describe(`${BASE}`, () => {
  let url = `${BASE}/SOME_STRANGE_URL`
  it(`404 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`404 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`404 PATCH ${url}`, async () => {
    await supertest(ROOT_URL).patch(url)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`404 DELETE ${url}`, async () => {
    await supertest(ROOT_URL).delete(url)
      .expect(StatusCodes.NOT_FOUND);
  });
});
