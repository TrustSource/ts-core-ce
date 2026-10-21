/* eslint-disable no-undef */
// Regression lock for GET /api/v2/core/modules/:id/environmental-context.
// The handler imports meteor/* (Iron Router, collections) and cannot be
// required under Jest, so the security + shape invariants are frozen with
// static-source assertions (the repo pattern for meteor-bound REST handlers).
// The response BODY shape is proven behaviourally in environmental-context.unit.spec.js
// (toEnvironmentalContext), which this handler is asserted to call.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../imports/server/rest-api/modules.js'), 'utf8');

describe('#104 modules.js environmental-context route', () => {
  it('registers GET /api/v2/core/modules/:id/environmental-context wired to getModuleEnvironmentalContext', () => {
    expect(src).toMatch(/Router\.route\('\/api\/v2\/core\/modules\/:id\/environmental-context'/);
    expect(src).toMatch(/action:\s*RestApi\.wrapAsync\(getModuleEnvironmentalContext\)/);
  });

  it('imports the shared pure helper (single source of truth, no re-derivation)', () => {
    expect(src).toMatch(/import\s*\{\s*toEnvironmentalContext\s*\}\s*from\s*'\/imports\/lib\/converter\/environmentalContext'/);
  });

  it('exposes a test-only named export of the GET handler', () => {
    expect(src).toMatch(/export\s*\{[^}]*\bhandleEnvironmentalContextGet\b[^}]*\}/);
  });

  it('dispatcher allows GET + OPTIONS only, else 405', () => {
    const dispatcher = src.match(/async function getModuleEnvironmentalContext\(\)\s*\{[\s\S]*?\n\}/);
    expect(dispatcher).not.toBeNull();
    const body = dispatcher[0];
    expect(body).toMatch(/method === 'GET'\)\s*\{\s*\n\s*await handleEnvironmentalContextGet\(/);
    expect(body).toMatch(/method === 'OPTIONS'\)\s*\{\s*\n\s*handleOptions\(/);
    expect(body).toMatch(/statusCode = 405/);
  });

  it('derives companyId ONLY from the API key (never body/query/path)', () => {
    const handler = src.match(/async function handleEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/);
    expect(handler).not.toBeNull();
    const body = handler[0];
    expect(body).toMatch(/getKeyMetaAndCompanyByAccountAndApiKey\(headers\['x-api-key'\]\)/);
    expect(body).toMatch(/const companyId = keyMetaAndCompany\.company\._id;/);
    // the selector must bind the key's companyId, not a client-supplied one
    expect(body).not.toMatch(/params\.companyId|body\.companyId|request\.query\.companyId/);
  });

  it('enforces the BOM read scope tier (403 "API-key scope is limited")', () => {
    const handler = src.match(/async function handleEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/)[0];
    expect(handler).toMatch(/validateKeyScope\(keyMetaAndCompany\.keyMeta, BOM_READ_ROLES\)/);
    expect(handler).toMatch(/response\.statusCode = 403;\s*\n\s*response\.end\(JSON\.stringify\(SCOPE_LIMITED\)\)/);
  });

  it('scopes the module lookup to {_id, companyId} with the focused projection and 404s on miss', () => {
    const handler = src.match(/async function handleEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/)[0];
    expect(handler).toMatch(/Modules\.findOneAsync\(\s*\{_id: params\.id, companyId\}/);
    expect(handler).toMatch(/fields:\s*\{name: 1, projectId: 1, ciaRequirements: 1, environmentalConfig: 1\}/);
    expect(handler).toMatch(/response\.statusCode = 404;\s*\n\s*response\.end\(JSON\.stringify\(RESOURCE_NF \+ params\.id\)\)/);
  });

  it('sets Cache-Control no-store and serializes via toEnvironmentalContext', () => {
    const handler = src.match(/async function handleEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/)[0];
    expect(handler).toMatch(/setHeader\('Cache-Control', 'no-cache, no-store'\)/);
    expect(handler).toMatch(/response\.end\(JSON\.stringify\(toEnvironmentalContext\(module\)\)\)/);
  });
});
