/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;

describe(`${BASE}/compliance/company/foss`, () => {
  let url = `${BASE}/compliance/company/foss`
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('name')
      })
  });
  it(`405 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.METHOD_NOT_ALLOWED);
  });
  it(`405 DELETE ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.METHOD_NOT_ALLOWED);
  });
});
