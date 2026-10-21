/* eslint-disable no-undef */
// Analysis and webhook delivery run in worker threads from workers/; nothing invokes
// AWS Lambda for them any more, and the Lambda settings are gone.
const fs = require('fs');
const path = require('path');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const REPO = path.join(__dirname, '../..');

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (entry.isFile() && /\.js$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('no Lambda invoke for analysis or webhooks', () => {
  it('no server code uses the Lambda client or the Lambda settings', () => {
    const pattern = /client-lambda|InvokeCommand|LambdaClient|\bTS_ANALYSIS\b|TS_ANALYSIS_REGION|\bTS_WEBHOOK\b|TS_WEBHOOK_REGION/;
    const offenders = walk('imports', []).filter((rel) => pattern.test(readSourceWithoutComments(rel)));
    expect(offenders).toEqual([]);
  });

  it('package.json has no Lambda client', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies || {})).not.toContain('@aws-sdk/client-lambda');
  });

  it('the Lambda payload reader is deleted', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/server/analysis/invokeResult.js'))).toBe(false);
  });
});

describe('the workers stay outside the Meteor build and ship in the image', () => {
  it('.meteorignore lists /workers/ and no stale lambdas entry', () => {
    const lines = fs.readFileSync(path.join(REPO, '.meteorignore'), 'utf8').split('\n').map((line) => line.trim());
    expect(lines).toContain('/workers/');
    expect(lines).not.toContain('imports/lambdas');
  });

  it('nothing under imports/ imports from workers/', () => {
    const offenders = walk('imports', []).filter((rel) => /from\s+['"][^'"]*\/workers\//.test(readSourceWithoutComments(rel)));
    expect(offenders).toEqual([]);
  });

  it('the image builds the workers and copies them to /opt/workers', () => {
    const dockerfile = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/RUN bash \$SCRIPTS_FOLDER\/build-workers\.sh/);
    expect(dockerfile).toMatch(/COPY --from=0 --chown=meteor:meteor \$APP_BUNDLE_FOLDER\/workers \/opt\/workers/);
  });
});
