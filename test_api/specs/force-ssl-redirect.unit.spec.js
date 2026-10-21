/* eslint-disable no-undef */
// HTTPS redirect behind a TLS proxy (packages/force-ssl). The package runs inside
// Meteor, so the pure decision function is lifted out of the source.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../packages/force-ssl/force_ssl_server.js'), 'utf8');

function liftFunction(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start === -1) {
    throw new Error(`force_ssl_server.js no longer defines ${name}`);
  }
  let depth = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) return new Function(`${SRC.slice(start, i + 1)}\nreturn ${name};`)();
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const httpsRedirectTarget = liftFunction('httpsRedirectTarget');

describe('httpsRedirectTarget', () => {
  it('redirects a proxied plain-HTTP request to ROOT_URL over HTTPS', () => {
    expect(httpsRedirectTarget('https://ts.example.org/', 'http', '/projects?x=1'))
      .toBe('https://ts.example.org/projects?x=1');
  });

  it('uses the first protocol of a forwarded list', () => {
    expect(httpsRedirectTarget('https://ts.example.org', 'http, https', '/')).toBe('https://ts.example.org/');
    expect(httpsRedirectTarget('https://ts.example.org', 'https, http', '/')).toBeNull();
  });

  it('leaves requests alone without a proxy header, over HTTPS, or when ROOT_URL is http', () => {
    expect(httpsRedirectTarget('https://ts.example.org', undefined, '/')).toBeNull();
    expect(httpsRedirectTarget('https://ts.example.org', 'https', '/')).toBeNull();
    expect(httpsRedirectTarget('http://localhost:3000/', 'http', '/')).toBeNull();
    expect(httpsRedirectTarget(undefined, 'http', '/')).toBeNull();
  });

  it('always targets the ROOT_URL host, never another one', () => {
    expect(httpsRedirectTarget('https://ts.example.org', 'http', '//evil.example/x'))
      .toBe('https://ts.example.org//evil.example/x');
    expect(httpsRedirectTarget('https://ts.example.org', 'http', 'http://evil.example/'))
      .toBe('https://ts.example.org/');
  });

  it('keeps answering /healthcheck before redirecting', () => {
    expect(SRC.indexOf("req.url.indexOf('/healthcheck') === 0"))
      .toBeLessThan(SRC.indexOf('httpsRedirectTarget(process.env.ROOT_URL'));
  });
});
