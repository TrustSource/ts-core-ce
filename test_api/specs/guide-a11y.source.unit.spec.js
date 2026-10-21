/* eslint-disable no-undef */
// Accessibility of the guide panel and tour styles (imports/client/stylesheets/
// common/guide.less): visible keyboard focus on the tour buttons and the Start
// tour button (WCAG 2.4.7), inactive tour dots at 3:1 (1.4.11) and step text at
// 4.5:1 on the hovered/focused step (1.4.3), in the light and the dark theme.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const styles = 'imports/client/stylesheets/';

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const guide = read(styles + 'common/guide.less');

// --- Minimal LESS reading -------------------------------------------------------

const variables = {};
['base/tokens.import.less', 'globals/variables.import.less', 'base/shell-layout.import.less',
  'themes/dark.import.less', 'common/guide.less'].forEach((file) => {
  for (const match of read(styles + file).matchAll(/^@([\w-]+):\s*([^;]+);/gm)) {
    variables[match[1]] = match[2].trim();
  }
});

// The body of the first block opened by `selector` inside `source`.
function block(source, selector) {
  const start = source.indexOf(selector + ' {');
  if (start < 0) throw new Error('No block for ' + selector);
  let depth = 0;
  const open = source.indexOf('{', start);
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error('Unclosed block for ' + selector);
}

// A declaration of the block itself, nested blocks left out.
function declaration(body, property) {
  let flat = body;
  while (/\{[^{}]*\}/.test(flat)) flat = flat.replace(/[^;{}]*\{[^{}]*\}/g, '');
  const match = flat.match(new RegExp('(?:^|[;\\s])' + property + ':\\s*([^;]+);'));
  if (!match) throw new Error('No ' + property + ' in block');
  return match[1].trim();
}

function hex(value) {
  let digits = value.replace('#', '');
  if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('');
  return {rgb: [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)), alpha: 1};
}

// Resolves a hex colour, a variable or fade(<colour>, <n>%).
function colour(value) {
  value = value.trim();
  if (value.startsWith('#')) return hex(value);
  if (value.startsWith('@')) {
    const name = value.slice(1);
    if (!(name in variables)) throw new Error('Unknown variable ' + value);
    return colour(variables[name]);
  }
  const fade = value.match(/^fade\((.+),\s*([\d.]+)%\)$/);
  if (fade) return {rgb: colour(fade[1]).rgb, alpha: Number(fade[2]) / 100};
  throw new Error('Cannot resolve colour ' + value);
}

// --- WCAG contrast --------------------------------------------------------------

function over(top, base) {
  return top.rgb.map((channel, i) => channel * top.alpha + base.rgb[i] * (1 - top.alpha));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe('WCAG contrast helper', () => {
  it('matches the reference ratios', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast(hex('#777').rgb, hex('#fff').rgb)).toBeCloseTo(4.48, 2);
  });
});

// --- Focus ----------------------------------------------------------------------

describe('guide keyboard focus', () => {
  // buttons.import.less removes the outline on `.btn:focus` (0,2,0); these
  // selectors are (0,3,0) so they win regardless of import order.
  const selectors = ['.ts-tour-tooltip .btn:focus-visible', '.btn.guide-start-tour:focus-visible'];

  it('matches the real button markup', () => {
    expect(read('imports/client/ui/common/guide/tour.js')).toMatch(/el\('button', 'btn btn-sm ' \+ className/);
    expect(read('imports/client/ui/common/guide/guide-panel.html')).toMatch(/class="btn [^"]*guide-start-tour"/);
  });

  it.each(selectors)('draws an outline on %s', (selector) => {
    const rule = guide.replace(/\/\/.*$/gm, '').match(/([^{}]+)\{([^{}]*)\}/g)
      .find((text) => text.split('{')[0].split(',').map((s) => s.trim()).includes(selector));
    expect(rule).toBeDefined();
    expect(rule).toMatch(/outline:\s*2px solid @ts-teal;/);
  });
});

// --- Tour dots ------------------------------------------------------------------

describe('tour step dots', () => {
  const dark = block(guide, '.theme-dark');
  const themes = {
    light: {bullet: block(guide, '.ts-tour-bullet'), background: colour('@shell-bg')},
    dark: {bullet: block(dark, '.ts-tour-bullet'), background: colour('@color-bg-lighter')}
  };

  it.each(Object.keys(themes))('inactive dots reach 3:1 in the %s theme', (theme) => {
    const {bullet, background} = themes[theme];
    const dot = colour(declaration(bullet, 'background'));
    expect(contrast(over(dot, background), background.rgb)).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.keys(themes))('active dots stay distinct in the %s theme', (theme) => {
    const {bullet} = themes[theme];
    const active = block(bullet, '&.active');
    expect(declaration(active, 'background')).not.toBe(declaration(bullet, 'background'));
  });
});

// --- Step text on hover/focus ---------------------------------------------------

describe('guide step text on the hovered/focused step', () => {
  const dark = block(guide, '.theme-dark');
  const themes = {
    light: {
      hover: block(block(guide, '.guide-step-show'), '&:hover,\n  &:focus'),
      base: colour('@shell-bg'),
      texts: [declaration(block(guide, '.guide-step-text'), 'color'), declaration(block(guide, '.guide-step-missing'), 'color')]
    },
    dark: {
      hover: block(dark, '.guide-step-show:hover,\n  .guide-step-show:focus'),
      base: colour('@color-bg-lighter'),
      texts: [declaration(block(dark, '.guide-step-missing'), 'color')]
    }
  };

  it.each(Object.keys(themes))('reaches 4.5:1 in the %s theme', (theme) => {
    const {hover, base, texts} = themes[theme];
    const background = over(colour(declaration(hover, 'background')), base);
    texts.forEach((text) => {
      expect(contrast(over(colour(text), {rgb: background}), background)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
