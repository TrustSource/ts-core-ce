/* eslint-disable no-undef */
// The stylesheets are TrustSource CE's own. The class names, LESS variables and files
// of the third-party admin theme the first UI was built on were replaced before the
// public release; this keeps them from coming back.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const CLIENT = path.join(ROOT, 'imports/client');

function walk(dir, exts, acc) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, acc);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      acc.push(full);
    }
  }
  return acc;
}

const FILES = walk(CLIENT, ['.html', '.js', '.less'], []);
const LESS = FILES.filter((file) => file.endsWith('.less'));
const rel = (file) => path.relative(ROOT, file);

describe('own class names', () => {
  const OLD_CLASSES = ['hpanel', 'color-line', 'normalheader', 'small-header', 'fixed-small-header', 'splash-title',
    'hbreadcrumb', 'hbuilt', 'panel-tools', 'clip-header', 'animated-panel', 'animate-panel', 'big-icon',
    'showhide', 'closebox', 'hdropdown'];

  it.each(OLD_CLASSES)('nothing uses .%s', (name) => {
    const pattern = new RegExp(`(?<![\\w-])${name}(?![\\w-])`);
    expect(FILES.filter((file) => pattern.test(fs.readFileSync(file, 'utf8'))).map(rel)).toEqual([]);
  });
});

describe('own LESS tokens', () => {
  const OLD_VARIABLES = ['color-navy-blue', 'color-violet', 'color-blue', 'color-green', 'color-yellow',
    'color-orange', 'color-red', 'color-red-deep', 'color-text', 'color-bright', 'color-background',
    'border-color', 'main-transition', 'menu-width'];

  it.each(OLD_VARIABLES)('no stylesheet uses @%s', (name) => {
    const pattern = new RegExp(`@${name}(?![\\w-])`);
    expect(LESS.filter((file) => pattern.test(fs.readFileSync(file, 'utf8'))).map(rel)).toEqual([]);
  });

  it('defines the palette once, in base/tokens.import.less', () => {
    const tokens = fs.readFileSync(path.join(CLIENT, 'stylesheets/base/tokens.import.less'), 'utf8');
    expect(tokens).toMatch(/@ts-teal: #2a94a2;/);
    expect(LESS.filter((file) => /@ts-sidebar-width\s*:/.test(fs.readFileSync(file, 'utf8'))).map(rel))
      .toEqual(['imports/client/stylesheets/base/tokens.import.less']);
  });
});

describe('stylesheet entry point', () => {
  const style = fs.readFileSync(path.join(CLIENT, 'stylesheets/style.less'), 'utf8');
  const imports = [...style.matchAll(/@import "([^"]+)"/g)].map((match) => match[1]);

  it('imports only files that exist', () => {
    expect(imports.filter((file) => !fs.existsSync(path.join(CLIENT, 'stylesheets', file)))).toEqual([]);
  });

  it('no longer imports the replaced theme files', () => {
    const replaced = ['margins', 'alerts', 'modal', 'progress_bar', 'login', 'dropdown', 'buttons', 'fonts',
      'icheck', 'layout', 'lists', 'panels', 'tabs', 'tooltip', 'various'].map((name) => `globals/${name}.import.less`);
    expect(imports.filter((file) => replaced.includes(file))).toEqual([]);
    replaced.forEach((file) => expect(fs.existsSync(path.join(CLIENT, 'stylesheets', file))).toBe(false));
  });

  it('loads the tokens first and the dark theme last', () => {
    expect(imports[0]).toBe('base/tokens.import.less');
    expect(imports[imports.length - 1]).toBe('themes/dark.import.less');
  });
});

describe('Open Sans is self-hosted', () => {
  it('no client file loads fonts from Google', () => {
    const pages = walk(path.join(ROOT, 'client'), ['.html', '.js'], []).concat(FILES);
    expect(pages.filter((file) => /fonts\.(googleapis|gstatic)\.com/.test(fs.readFileSync(file, 'utf8'))).map(rel))
      .toEqual([]);
  });

  it('every font file the stylesheet names ships in public/fonts/open-sans', () => {
    const fontsLess = fs.readFileSync(path.join(CLIENT, 'stylesheets/base/fonts.import.less'), 'utf8');
    const calls = [...fontsLess.matchAll(/^\.open-sans-face\((\d+); ([a-z-]+);/gm)];
    expect(calls.length).toBe(8);
    calls.forEach(([, weight, subset]) => {
      expect(fs.existsSync(path.join(ROOT, `public/fonts/open-sans/open-sans-${subset}-${weight}-normal.woff2`))).toBe(true);
    });
    expect(fs.existsSync(path.join(ROOT, 'public/fonts/open-sans/OFL.txt'))).toBe(true);
  });
});
