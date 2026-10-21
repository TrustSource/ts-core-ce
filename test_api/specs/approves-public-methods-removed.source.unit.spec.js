/* eslint-disable no-undef */
// GET /api/v1/csaf (the public VEX-by-purl feed) was deleted with API v1. It was
// the only caller of Approves.PublicFind, Approves.PublicFile and
// Approves.SaveRequest, and any signed-in user could still call them over DDP,
// so the methods and their interactors go with it. The release VEX stays at
// GET /api/v2/compliance/releases/:id/csaf (publicVexKey.getFile).
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

function jsFiles(dir) {
  const out = [];
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach(function (entry) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        out.push.apply(out, jsFiles(rel));
      }
    } else if (/\.js$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('Approves public lookup methods removed', () => {
  it('has no interactor file any more', () => {
    expect(exists('imports/lib/interactors/approves/publicFind.js')).toBe(false);
    expect(exists('imports/lib/interactors/approves/publicFile.js')).toBe(false);
    expect(exists('imports/lib/interactors/approves/saveRequest.js')).toBe(false);
  });

  it('exports none of the three names from the approves interactor index', () => {
    const index = read('imports/lib/interactors/approves/index.js');
    expect(index).not.toMatch(/ApprovesPublicFind/);
    expect(index).not.toMatch(/ApprovesPublicFile/);
    expect(index).not.toMatch(/ApprovesSaveRequest/);
  });

  it('registers none of the three DDP methods, and still registers Approves.Create', () => {
    const startup = read('imports/startup/server/approves.js');
    expect(startup).not.toMatch(/Approves\.PublicFind/);
    expect(startup).not.toMatch(/Approves\.PublicFile/);
    expect(startup).not.toMatch(/Approves\.SaveRequest/);
    expect(startup).toMatch(/'Approves\.Create':\s*ApprovesCreate/);
  });

  it('leaves no reference behind in imports/', () => {
    const pattern = /Approves\.PublicFind|Approves\.PublicFile|Approves\.SaveRequest|ApprovesPublicFind|ApprovesPublicFile|ApprovesSaveRequest/;
    const offenders = jsFiles('imports').filter(function (file) {
      return pattern.test(read(file));
    });
    expect(offenders).toEqual([]);
  });
});
