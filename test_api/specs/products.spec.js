/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

const url = `${BASE}/core/products`;
const stamp = Date.now();
const identifier = `api-test-product-${stamp}`;
const childIdentifier = `api-test-product-child-${stamp}`;

describe(`${BASE}/core/products`, () => {
  let productId;  // captured from the create response, reused by single-resource specs
  let misuseId;   // captured from the add-misuse response
  let supportId;  // captured from the add-support response

  //
  //   AUTH
  //
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`405 DELETE ${url}`, async () => {
    await supertest(ROOT_URL).delete(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED);
  });

  //
  //   CREATE
  //
  it(`400 POST ${url} - missing required fields`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', API_KEY)
      .send({name: 'Incomplete'})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`201 POST ${url} - create`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', API_KEY)
      .send({type: 'software', identifier, name: 'API Test Product', description: 'created via api test', demo: true})
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('_id');
        expect(response.body.identifier).toEqual(identifier);
        expect(response.body.name).toEqual('API Test Product');
        expect(response.body.demo).toBe(true);
        productId = response.body._id;
      });
  });
  it(`400 POST ${url} - duplicate identifier`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', API_KEY)
      .send({type: 'software', identifier, name: 'Dup'})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`400 POST ${url} - non-string identifier is rejected (no NoSQL operator injection)`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', API_KEY)
      .send({type: 'software', identifier: {$regex: '.*'}, name: 'Injection'})
      .expect(StatusCodes.BAD_REQUEST);
  });

  //
  //   READ
  //
  it(`200 GET ${url} - list`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(Array.isArray(response.body)).toBeTruthy();
        expect(response.body.some((p) => p._id === productId)).toBeTruthy();
      });
  });
  it(`200 GET ${url} - list returns parentId so clients can rebuild the tree`, async () => {
    // create a child whose parentId points at the product created above
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', API_KEY)
      .send({type: 'software', identifier: childIdentifier, name: 'API Test Child', parentId: identifier, demo: true})
      .expect(StatusCodes.CREATED);
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const child = response.body.find((p) => p.identifier === childIdentifier);
        expect(child).toBeDefined();
        expect(child.parentId).toEqual(identifier);
      });
  });
  it(`200 GET ${url}/{id} - single`, async () => {
    await supertest(ROOT_URL).get(`${url}/${productId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body._id).toEqual(productId);
        expect(response.body.identifier).toEqual(identifier);
      });
  });
  it(`404 GET ${url}/{id} - unknown`, async () => {
    await supertest(ROOT_URL).get(`${url}/doesnotexist`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });

  //
  //   UPDATE
  //
  it(`200 POST ${url}/{id} - update`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}`)
      .set('x-api-key', API_KEY)
      .send({description: 'updated via api test', classification: 'internal'})
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.description).toEqual('updated via api test');
        expect(response.body.classification).toEqual('internal');
      });
  });
  it(`200 POST ${url}/{id} - server-managed fields are ignored`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}`)
      .set('x-api-key', API_KEY)
      .send({companyId: 'hacked', name: 'still updatable'})
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.companyId).not.toEqual('hacked');
        expect(response.body.name).toEqual('still updatable');
      });
  });
  it(`400 POST ${url}/{id} - non-string identifier is rejected (no NoSQL operator injection)`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}`)
      .set('x-api-key', API_KEY)
      .send({identifier: {$gt: ''}})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`400 POST ${url}/{id} - no updatable fields`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}`)
      .set('x-api-key', API_KEY)
      .send({demo: true})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`404 POST ${url}/{id} - unknown`, async () => {
    await supertest(ROOT_URL).post(`${url}/doesnotexist`)
      .set('x-api-key', API_KEY)
      .send({name: 'x'})
      .expect(StatusCodes.NOT_FOUND);
  });

  //
  //   ADD MISUSE
  //
  it(`400 POST ${url}/{id}/misuse - missing name`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/misuse`)
      .set('x-api-key', API_KEY)
      .send({description: 'no name'})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`404 POST ${url}/{id}/misuse - unknown`, async () => {
    await supertest(ROOT_URL).post(`${url}/doesnotexist/misuse`)
      .set('x-api-key', API_KEY)
      .send({name: 'x'})
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`201 POST ${url}/{id}/misuse - add misuse`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/misuse`)
      .set('x-api-key', API_KEY)
      .send({name: 'Credential stuffing', description: 'Automated login attempts using leaked credentials'})
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(Array.isArray(response.body.misuses)).toBeTruthy();
        const added = response.body.misuses.find((m) => m.name === 'Credential stuffing');
        expect(added).toBeDefined();
        expect(added._id).toBeDefined();
        expect(added.created).toBeDefined();
        expect(added.description).toEqual('Automated login attempts using leaked credentials');
        misuseId = added._id;
      });
  });
  it(`200 DELETE ${url}/{id}/misuse/{itemId} - remove misuse`, async () => {
    await supertest(ROOT_URL).delete(`${url}/${productId}/misuse/${misuseId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const stillThere = (response.body.misuses || []).some((m) => m._id === misuseId);
        expect(stillThere).toBeFalsy();
      });
  });

  //
  //   SUPPORT CONTRACTS
  //
  it(`400 POST ${url}/{id}/support - missing name`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/support`)
      .set('x-api-key', API_KEY)
      .send({description: 'no name'})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`400 POST ${url}/{id}/support - invalid endDate`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/support`)
      .set('x-api-key', API_KEY)
      .send({name: 'Gold', endDate: 'not-a-date'})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`201 POST ${url}/{id}/support - add support contract`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/support`)
      .set('x-api-key', API_KEY)
      .send({name: 'Gold support', description: '24/7', endDate: '2027-01-01'})
      .expect(StatusCodes.CREATED)
      .then((response) => {
        const added = (response.body.supportContracts || []).find((s) => s.name === 'Gold support');
        expect(added).toBeDefined();
        expect(added._id).toBeDefined();
        expect(added.created).toBeDefined();
        supportId = added._id;
      });
  });
  it(`200 DELETE ${url}/{id}/support/{itemId} - remove support contract`, async () => {
    await supertest(ROOT_URL).delete(`${url}/${productId}/support/${supportId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const stillThere = (response.body.supportContracts || []).some((s) => s._id === supportId);
        expect(stillThere).toBeFalsy();
      });
  });

  //
  //   SOLUTIONS (release links) - validation paths (happy path needs a real approval)
  //
  it(`400 POST ${url}/{id}/solution - missing approvalId/name`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/solution`)
      .set('x-api-key', API_KEY)
      .send({name: 'only name'})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`404 POST ${url}/{id}/solution - unknown product`, async () => {
    await supertest(ROOT_URL).post(`${url}/doesnotexist/solution`)
      .set('x-api-key', API_KEY)
      .send({approvalId: 'a1', name: 'Release 1'})
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`404 DELETE ${url}/{id}/solution/{approvalId} - unknown product`, async () => {
    await supertest(ROOT_URL).delete(`${url}/doesnotexist/solution/a1`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });

  //
  //   PHOTOS & DOCUMENTS - multipart/form-data; validation paths (happy path uploads to S3)
  //
  it(`400 POST ${url}/{id}/photo - multipart with no file part`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/photo`)
      .set('x-api-key', API_KEY)
      .field('dummy', '1')
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`404 POST ${url}/{id}/photo - unknown product`, async () => {
    await supertest(ROOT_URL).post(`${url}/doesnotexist/photo`)
      .set('x-api-key', API_KEY)
      .attach('file', Buffer.from('hi'), {filename: 'x.png', contentType: 'image/png'})
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`400 DELETE ${url}/{id}/photo - missing url`, async () => {
    await supertest(ROOT_URL).delete(`${url}/${productId}/photo`)
      .set('x-api-key', API_KEY)
      .send({})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`400 POST ${url}/{id}/document - invalid documentType`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/document`)
      .set('x-api-key', API_KEY)
      .field('documentType', 'bogus')
      .attach('file', Buffer.from('hi'), {filename: 'm.pdf', contentType: 'application/pdf'})
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`400 POST ${url}/{id}/document - valid type but no file part`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/document`)
      .set('x-api-key', API_KEY)
      .field('documentType', 'userManual')
      .expect(StatusCodes.BAD_REQUEST);
  });

  //
  //   RETIRE
  //
  it(`404 POST ${url}/{id}/retire - unknown`, async () => {
    await supertest(ROOT_URL).post(`${url}/doesnotexist/retire`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`200 POST ${url}/{id}/retire - retire`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/retire`)
      .set('x-api-key', API_KEY)
      .send({retiredReason: 'end of life'})
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.retired).toBeDefined();
        expect(response.body.retiredReason).toEqual('end of life');
      });
  });

  //
  //   UN-RETIRE
  //
  it(`404 POST ${url}/{id}/unretire - unknown`, async () => {
    await supertest(ROOT_URL).post(`${url}/doesnotexist/unretire`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`200 POST ${url}/{id}/unretire - un-retire`, async () => {
    await supertest(ROOT_URL).post(`${url}/${productId}/unretire`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.retired === null || response.body.retired === undefined).toBeTruthy();
      });
  });
});
