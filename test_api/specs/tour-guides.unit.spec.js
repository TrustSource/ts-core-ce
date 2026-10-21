/* eslint-disable no-undef */
// The guide panel and the guided tour read their steps from
// imports/lib/tour/guides.js. A step whose selector matches nothing silently
// degrades to a floating tooltip, which is how three of the old intro.js steps
// pointed at nothing without anyone noticing, so every selector is checked
// against the templates (and navigation.js, which sets the menu's classes).
const fs = require('fs');
const path = require('path');
const {GUIDES, ROUTE_GUIDES, guideIdForRoute, getGuide} = require('../../imports/lib/tour/guides');

const uiRoot = path.join(__dirname, '../../imports/client/ui');

function readAll(dir, exts) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return readAll(full, exts);
    return exts.includes(path.extname(entry.name)) ? [fs.readFileSync(full, 'utf8')] : [];
  }).join('\n');
}

const templates = readAll(uiRoot, ['.html']);
const navigation = fs.readFileSync(path.join(uiRoot, 'common/navigation.js'), 'utf8');

describe('guides', () => {
  it('maps the dashboard and every module tab to a guide', () => {
    expect(guideIdForRoute('dashboard')).toBe('welcome');
    ['moduleDependencies', 'moduleLicenses', 'moduleComponents', 'moduleVulnerability', 'moduleGraphs']
      .forEach((route) => expect(guideIdForRoute(route)).toBe('dependency'));
  });

  it('has no guide for other routes, and ignores prototype keys', () => {
    expect(guideIdForRoute('projectList')).toBeNull();
    expect(guideIdForRoute('constructor')).toBeNull();
    expect(getGuide('toString')).toBeNull();
  });

  it('points every route at an existing guide', () => {
    Object.values(ROUTE_GUIDES).forEach((id) => expect(getGuide(id)).toBeTruthy());
  });

  Object.entries(GUIDES).forEach(([id, guide]) => {
    describe(id, () => {
      it('has a title, a summary and steps', () => {
        expect(guide.title).toBeTruthy();
        expect(guide.summary).toBeTruthy();
        expect(guide.steps.length).toBeGreaterThan(0);
      });

      guide.steps.forEach((step) => {
        it(`step "${step.title}" has text and an existing anchor`, () => {
          expect(step.text).toBeTruthy();
          expect(['top', 'right', 'bottom', 'left']).toContain(step.position);
          const match = /^\.([\w-]+)$/.exec(step.selector);
          expect(match).not.toBeNull();
          const className = match[1];
          const inTemplate = new RegExp(`class="[^"]*\\b${className}\\b`).test(templates);
          const inNavigation = navigation.includes(`'${className}'`);
          expect(inTemplate || inNavigation).toBe(true);
        });
      });
    });
  });
});
