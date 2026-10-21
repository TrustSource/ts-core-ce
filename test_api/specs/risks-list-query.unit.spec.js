/* eslint-disable no-undef */
// Pure unit test for the risk-list selector builder. No Meteor, no running
// app, no API key - requires the helper directly and asserts the Mongo
// selector shape for each of the three stored risk shapes:
//   (1) project-only  {projectId}
//   (2) module-only   {moduleId}
//   (3) both-fields   {projectId, moduleId}  (threat-model REST risks)
//
// Maps to acceptance criteria 2, 3, 5, 6, 7 at the selector level (the
// end-to-end HTTP assertions live in risks.spec.js, which needs a live app).
const {buildRiskListSelector} = require('../../imports/lib/interactors/riskProperties/listQuery');

describe('riskProperties listQuery.buildRiskListSelector', () => {
  const companyId = 'company-1';

  describe('moduleId branch', () => {
    it('scopes by company + moduleId only, without any $exists clause', () => {
      // Catches module-only (shape 2) AND both-fields (shape 3) rows.
      const selector = buildRiskListSelector({companyId, moduleId: 'M1'});
      expect(selector).toEqual({companyId, moduleId: 'M1'});
    });

    it('adds the name filter when present', () => {
      const selector = buildRiskListSelector({companyId, moduleId: 'M1', name: 'sqli'});
      expect(selector).toEqual({companyId, moduleId: 'M1', name: 'sqli'});
    });

    it('takes precedence over projectId when both are supplied (UI both-set call)', () => {
      const selector = buildRiskListSelector({companyId, moduleId: 'M1', projectId: 'P1'});
      // both-set call is intentionally moduleId-scoped; projectId is ignored here
      expect(selector).toEqual({companyId, moduleId: 'M1'});
    });
  });

  describe('projectId branch', () => {
    it('uses a single $or with project-only and module-in clauses when modules exist', () => {
      const selector = buildRiskListSelector({companyId, projectId: 'P1'}, ['M1', 'M2']);
      expect(selector).toEqual({
        companyId,
        $or: [
          {projectId: 'P1', moduleId: {$exists: false}},
          {moduleId: {$in: ['M1', 'M2']}}
        ]
      });
    });

    it('omits the module-in clause when the project has no modules', () => {
      const selector = buildRiskListSelector({companyId, projectId: 'P1'}, []);
      expect(selector).toEqual({
        companyId,
        $or: [
          {projectId: 'P1', moduleId: {$exists: false}}
        ]
      });
    });

    it('omits the module-in clause when projectModuleIds is not provided', () => {
      const selector = buildRiskListSelector({companyId, projectId: 'P1'});
      expect(selector).toEqual({
        companyId,
        $or: [
          {projectId: 'P1', moduleId: {$exists: false}}
        ]
      });
    });

    it('adds name at the top level so it ANDs across the $or branches', () => {
      const selector = buildRiskListSelector({companyId, projectId: 'P1', name: 'sqli'}, ['M1']);
      expect(selector).toEqual({
        companyId,
        name: 'sqli',
        $or: [
          {projectId: 'P1', moduleId: {$exists: false}},
          {moduleId: {$in: ['M1']}}
        ]
      });
    });

    it('matches both-fields rows via the module-in clause (shape 3 found by project)', () => {
      // A both-fields risk {projectId:P1, moduleId:M1} is reached because M1 is
      // among the project modules - the $in clause has no moduleId:$exists guard.
      const selector = buildRiskListSelector({companyId, projectId: 'P1'}, ['M1']);
      const orClauses = selector.$or;
      const moduleInClause = orClauses.find(c => c.moduleId && c.moduleId.$in);
      expect(moduleInClause).toEqual({moduleId: {$in: ['M1']}});
      // and the project-only clause still excludes module rows to avoid double-count
      const projectOnlyClause = orClauses.find(c => c.projectId);
      expect(projectOnlyClause).toEqual({projectId: 'P1', moduleId: {$exists: false}});
    });
  });

  describe('no filter', () => {
    it('returns null when neither moduleId nor projectId is given', () => {
      expect(buildRiskListSelector({companyId})).toBeNull();
    });
  });

  // --- hardening: edge cases the selector logic governs ---
  describe('cross-project isolation (criterion 10 at the selector level)', () => {
    it('does NOT leak a module that is outside the project module set into the $or', () => {
      // M_OTHER belongs to a different project; only M1/M2 are in this project.
      // The $in must contain exactly the project modules, so a both-fields row
      // {projectId:P1, moduleId:M_OTHER} can never be reached by ?projectId=P1.
      const selector = buildRiskListSelector({companyId, projectId: 'P1'}, ['M1', 'M2']);
      const moduleInClause = selector.$or.find(c => c.moduleId && c.moduleId.$in);
      expect(moduleInClause.moduleId.$in).toEqual(['M1', 'M2']);
      expect(moduleInClause.moduleId.$in).not.toContain('M_OTHER');
      // project-only clause matches on projectId, never on a foreign moduleId
      const projectOnlyClause = selector.$or.find(c => c.projectId);
      expect(projectOnlyClause).not.toHaveProperty('moduleId.$in');
    });

    it('ignores projectModuleIds in the moduleId branch (no foreign modules pulled in)', () => {
      // Even if a stale/foreign module list is passed, the moduleId branch stays
      // strictly scoped to the requested moduleId - projectModuleIds is unused here.
      const selector = buildRiskListSelector({companyId, moduleId: 'M1'}, ['X1', 'X2']);
      expect(selector).toEqual({companyId, moduleId: 'M1'});
      expect(JSON.stringify(selector)).not.toContain('X1');
      expect(JSON.stringify(selector)).not.toContain('$in');
    });
  });

  describe('companyId tenant scope is non-negotiable (criteria 10 & 12)', () => {
    it('is present in the moduleId-branch selector', () => {
      expect(buildRiskListSelector({companyId, moduleId: 'M1'}).companyId).toBe(companyId);
    });
    it('is present in the both-set (moduleId+projectId) selector', () => {
      expect(buildRiskListSelector({companyId, moduleId: 'M1', projectId: 'P1'}).companyId).toBe(companyId);
    });
    it('is present at the top level of the projectId-branch selector (with modules)', () => {
      const selector = buildRiskListSelector({companyId, projectId: 'P1'}, ['M1']);
      expect(selector.companyId).toBe(companyId);
      // companyId ANDs across the $or - it lives at the top level, not inside a branch
      selector.$or.forEach(c => expect(c).not.toHaveProperty('companyId'));
    });
    it('is present at the top level of the projectId-branch selector (no modules)', () => {
      expect(buildRiskListSelector({companyId, projectId: 'P1'}, []).companyId).toBe(companyId);
    });
  });

  describe('de-dup is structural (criterion 5)', () => {
    it('shape-3 {projectId,moduleId} matches the $in clause only, never the project-only clause', () => {
      // The project-only clause carries moduleId:$exists:false, so a row that
      // HAS a moduleId cannot match it. Shape 3 is therefore reached by exactly
      // one $or branch -> Mongo returns it once, no concat/de-dup needed.
      const selector = buildRiskListSelector({companyId, projectId: 'P1'}, ['M1']);
      const shape3 = {projectId: 'P1', moduleId: 'M1'};
      const projectOnlyClause = selector.$or.find(c => Object.prototype.hasOwnProperty.call(c, 'projectId'));
      const moduleInClause = selector.$or.find(c => c.moduleId && c.moduleId.$in);
      // project-only clause requires moduleId absent -> shape 3 (which has moduleId) excluded
      expect(projectOnlyClause.moduleId).toEqual({$exists: false});
      expect(shape3).toHaveProperty('moduleId');
      // $in clause matches shape 3 because its moduleId is among the project modules
      expect(moduleInClause.moduleId.$in).toContain(shape3.moduleId);
    });
  });

  describe('falsy name is not added to the selector', () => {
    it('omits an empty-string name in the moduleId branch', () => {
      const selector = buildRiskListSelector({companyId, moduleId: 'M1', name: ''});
      expect(selector).toEqual({companyId, moduleId: 'M1'});
      expect(selector).not.toHaveProperty('name');
    });
    it('omits an empty-string name in the projectId branch', () => {
      const selector = buildRiskListSelector({companyId, projectId: 'P1', name: ''}, ['M1']);
      expect(selector).not.toHaveProperty('name');
    });
    it('omits an undefined name (sanitizer asString returns undefined for non-strings)', () => {
      // find.js runs params.name = asString(name); non-string input -> undefined.
      const selector = buildRiskListSelector({companyId, projectId: 'P1', name: undefined}, ['M1']);
      expect(selector).not.toHaveProperty('name');
    });
  });
});
