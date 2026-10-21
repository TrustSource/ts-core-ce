/**
 * Test data factories for building minimal company/project/module/scan/user objects.
 */

export function makeCompany(overrides = {}) {
  return {
    _id: 'COMPANY_1',
    name: 'Test Company',
    accountType: 'standard',
    statistics: [],
    privateLicenses: [],
    licenseConfig: {},
    cveConfig: {},
    componentConfig: {},
    algorithmsConfig: [],
    ...overrides
  };
}

export function makeProject(overrides = {}) {
  return {
    _id: 'PROJECT_1',
    name: 'Test Project',
    companyId: 'COMPANY_1',
    requirements: {},
    licenseConfig: {},
    cveConfig: {},
    componentConfig: {},
    ...overrides
  };
}

export function makeModule(overrides = {}) {
  return {
    _id: 'MODULE_1',
    name: 'test-module',
    companyId: 'COMPANY_1',
    projectId: 'PROJECT_1',
    requirements: {},
    licenseConfig: {},
    cveConfig: {},
    componentConfig: {},
    customComponents: [],
    ...overrides
  };
}

export function makeScan(dependencies = [], overrides = {}) {
  return {
    _id: 'SCAN_1',
    module: 'test-module',
    moduleId: 'MODULE_1',
    companyId: 'COMPANY_1',
    dependencyCount: dependencies.length,
    dependencies,
    ...overrides
  };
}

export function makeDependency(key, version, opts = {}) {
  return {
    key,
    name: opts.name || key.split(':').slice(1).join(':'),
    versions: [version],
    dependencies: opts.dependencies || [],
    ...opts
  };
}

export function makeUser(overrides = {}) {
  return {
    _id: 'USER_1',
    profile: {
      name: 'Test User',
      companyId: 'COMPANY_1',
      email: 'test@example.com'
    },
    emails: [{ address: 'test@example.com' }],
    ...overrides
  };
}

export function makeContext() {
  return {
    awsRequestId: 'test-request-id-12345',
    functionName: 'ts-analysis',
    functionVersion: '$LATEST'
  };
}

export function makeComponent(key, versions = [], overrides = {}) {
  return {
    _id: `comp-${key}`,
    key,
    name: key,
    urls: {},
    versions: versions.map(v => typeof v === 'string' ? { version: v } : v),
    private: false,
    ...overrides
  };
}
