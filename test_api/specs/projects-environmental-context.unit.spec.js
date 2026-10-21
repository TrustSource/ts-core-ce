/* eslint-disable no-undef */
// Regression lock for GET /api/v2/core/projects/:id/environmental-context.
// Static-source assertions (handler imports meteor/*). Returns one
// environmental-context object per module in the project; the project itself is
// verified to belong to the key's company before any module is read, and the
// module query is re-scoped by the SAME company so a foreign project id can
// never surface another tenant's modules.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../imports/server/rest-api/projects.js'), 'utf8');

describe('#104 projects.js environmental-context route', () => {
  it('registers GET /api/v2/core/projects/:id/environmental-context wired to getProjectEnvironmentalContext', () => {
    expect(src).toMatch(/Router\.route\('\/api\/v2\/core\/projects\/:id\/environmental-context'/);
    expect(src).toMatch(/action:\s*RestApi\.wrapAsync\(getProjectEnvironmentalContext\)/);
  });

  it('imports the shared pure helper (single source of truth with the module route)', () => {
    expect(src).toMatch(/import\s*\{\s*toEnvironmentalContext\s*\}\s*from\s*'\/imports\/lib\/converter\/environmentalContext'/);
  });

  it('exposes a test-only named export of the GET handler', () => {
    expect(src).toMatch(/export\s*\{[^}]*\bhandleProjectEnvironmentalContextGet\b[^}]*\}/);
  });

  it('dispatcher allows GET + OPTIONS only, else 405', () => {
    const dispatcher = src.match(/async function getProjectEnvironmentalContext\(\)\s*\{[\s\S]*?\n\}/);
    expect(dispatcher).not.toBeNull();
    const body = dispatcher[0];
    expect(body).toMatch(/method === 'GET'\)\s*\{\s*\n\s*await handleProjectEnvironmentalContextGet\(/);
    expect(body).toMatch(/method === 'OPTIONS'\)\s*\{\s*\n\s*handleOptions\(/);
    expect(body).toMatch(/statusCode = 405/);
  });

  it('derives companyId ONLY from the API key and enforces the BOM read tier', () => {
    const handler = src.match(/async function handleProjectEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/);
    expect(handler).not.toBeNull();
    const body = handler[0];
    expect(body).toMatch(/getKeyMetaAndCompanyByAccountAndApiKey\(headers\['x-api-key'\]\)/);
    expect(body).toMatch(/const companyId = keyMetaAndCompany\.company\._id;/);
    expect(body).toMatch(/validateKeyScope\(keyMetaAndCompany\.keyMeta, BOM_READ_ROLES\)/);
    expect(body).not.toMatch(/params\.companyId|body\.companyId|request\.query\.companyId/);
  });

  it('verifies the project belongs to the company (foreign projectId -> 404) BEFORE reading modules', () => {
    const body = src.match(/async function handleProjectEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/)[0];
    const projIdx = body.indexOf('Projects.findOneAsync({_id: params.id, companyId}');
    const modIdx = body.indexOf('Modules.find({projectId: params.id, companyId}');
    expect(projIdx).toBeGreaterThan(-1);
    expect(modIdx).toBeGreaterThan(-1);
    expect(projIdx).toBeLessThan(modIdx);
    expect(body).toMatch(/response\.statusCode = 404;\s*\n\s*response\.end\(JSON\.stringify\(RESOURCE_NF \+ params\.id\)\)/);
  });

  it('re-scopes the module query by the SAME company (no cross-tenant leak) with the focused projection', () => {
    const body = src.match(/async function handleProjectEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/)[0];
    expect(body).toMatch(/Modules\.find\(\{projectId: params\.id, companyId\}/);
    expect(body).toMatch(/fields:\s*\{name: 1, projectId: 1, ciaRequirements: 1, environmentalConfig: 1\}/);
  });

  it('bounds the result to a page of FETCH_LIMIT (100) sorted by name and maps each module via toEnvironmentalContext', () => {
    const body = src.match(/async function handleProjectEnvironmentalContextGet\(request, params, response\)\s*\{[\s\S]*?\n\}/)[0];
    expect(body).toMatch(/limit:\s*FETCH_LIMIT/);
    expect(body).toMatch(/sort:\s*\{name: 1, _id: 1\}/);
    expect(body).toMatch(/\.map\(toEnvironmentalContext\)/);
    expect(body).toMatch(/setHeader\('Cache-Control', 'no-cache, no-store'\)/);
  });
});
