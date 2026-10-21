/* eslint-disable no-undef */
// The Community Edition runs on no AWS service, so its production source should
// not describe itself in AWS terms either. Analysis and webhooks are worker
// threads, files are on a volume, API keys are the app's own, and the CSAF
// provider comes from the environment - a comment still naming a Lambda, a
// bucket or API Gateway sends the next reader looking for infrastructure that
// is not there.
//
// Scope is PRODUCTION source only. The removal-guard specs (no-obom,
// lambda-invoke-removed, api-gateway-removed, no-s3, this one) name AWS on
// purpose - that is what they guard - and so do a handful of tests that use an
// AWS-shaped value as INPUT.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');

function walk(dir, acc) {
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'test') { continue; }
      walk(rel, acc);
    } else if (/\.(js|mjs|cjs|less|html|sh|md)$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      acc.push(rel);
    }
  }
  return acc;
}

const SOURCE = ['imports', 'server', 'client', 'packages', 'tools', 'docker', 'workers']
  .reduce((acc, dir) => walk(dir, acc), []);

// `Amazon Digital Services License` is an SPDX license name in the license
// dropdown, not a service this app talks to.
const ALLOWED = {'imports/lib/utils.js': /Amazon Digital Services License/};

const AWS_WORDS = /\bAWS\b|\bAmazon\b|amazonaws|API Gateway|Secrets Manager|Fargate|\bELB\b|\bLambdas?\b|\bSSM\b|\bSQS\b|\bSNS\b|\bS3\b|Bedrock/;

describe('no production source describes itself in AWS terms', () => {
  it('finds source files to check at all', () => {
    expect(SOURCE.length).toBeGreaterThan(100);
  });

  it('names no AWS service', () => {
    const offenders = SOURCE.filter((rel) => {
      let text = fs.readFileSync(path.join(root, rel), 'utf8');
      if (ALLOWED[rel]) { text = text.replace(ALLOWED[rel], ''); }
      return AWS_WORDS.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe('the SaaS-only AWS files are gone', () => {
  it.each([
    'tools/aws',
    'awscf'
  ])('%s no longer exists', (rel) => {
    expect(fs.existsSync(path.join(root, rel))).toBe(false);
  });
});

describe('the legacy AWS document fields are gone', () => {
  it('no user document field carries a Bedrock session', () => {
    expect(fs.readFileSync(path.join(root, 'imports/lib/schemas/userSchema.js'), 'utf8'))
      .not.toMatch(/bedrockSessionId/);
  });

  it('no company projection hides an API Gateway usage plan', () => {
    const offenders = SOURCE.filter((rel) => /usagePlanId/.test(fs.readFileSync(path.join(root, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  // usagePlanId was the ONLY difference between the base and full secret sets,
  // so one list now serves every projection site - which is the property the
  // consistency specs exist to protect.
  it('one secret-exclusion list serves every company projection', () => {
    const mod = require('../../imports/server/security/companySecretFields');
    expect(Object.keys(mod)).toEqual(['COMPANY_SECRET_EXCLUDE']);
  });
});

describe('.env.example documents the reference deployment', () => {
  const example = () => fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  it('exists', () => {
    expect(fs.existsSync(path.join(root, '.env.example'))).toBe(true);
  });

  // The file is only useful if it stays in step with the compose file it feeds.
  it('documents every variable docker-compose.yml interpolates', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    const used = [...new Set([...compose.matchAll(/\$\{([A-Z_0-9]+)/g)].map((m) => m[1]))].sort();
    const documented = example();
    expect(used.filter((name) => !new RegExp(`^#?${name}=`, 'm').test(documented))).toEqual([]);
  });

  it('carries no real credential, only placeholders', () => {
    for (const line of example().split('\n')) {
      if (/^(TS_API_KEY|TS_ENCRYPTION_KEY|INITIAL_ADMIN_PASSWORD|MONGO_ROOT_PASSWORD|TS_CSAF_PROVIDER_PASSWORD|TS_CSAF_PROVIDER_PASSPHRASE)=/.test(line)) {
        expect(line.split('=')[1]).toBe('');
      }
    }
  });

  it('is not itself ignored, while .env is', () => {
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(ignore).toContain('.env*');
    expect(ignore).toContain('!.env.example');
    expect(ignore.indexOf('!.env.example')).toBeGreaterThan(ignore.indexOf('.env*'));
  });
});
