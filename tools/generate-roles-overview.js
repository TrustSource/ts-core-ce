#!/usr/bin/env node
/*
 * generate-roles-overview.js
 *
 * Parses imports/lib/userExtUtils.js (the single source of truth for the
 * role-based permission matrix) and renders a human-readable overview into
 * ROLES_AND_PERMISSIONS.md at the repo root.
 *
 * The overview is meant for support staff: it answers "which action requires
 * which role?" without anyone having to read the JS.
 *
 * Usage:
 *   node tools/generate-roles-overview.js          # write ROLES_AND_PERMISSIONS.md
 *   node tools/generate-roles-overview.js --check   # exit 1 if the file is stale
 *
 * The companion GitHub Action (.github/workflows/roles-overview.yml) runs this
 * on every change to userExtUtils.js and keeps the markdown in sync.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'imports', 'lib', 'userExtUtils.js');
const OUTPUT = path.join(REPO_ROOT, 'ROLES_AND_PERMISSIONS.md');
const SOURCE_REL = 'imports/lib/userExtUtils.js';

// ---------------------------------------------------------------------------
// 1. Extract the allRoles() data literal from the source file.
//    The returned array is pure data (no references to imports), so once the
//    array text is isolated it can be evaluated safely in isolation.
// ---------------------------------------------------------------------------

function extractRolesArray(src) {
  const marker = 'UserExtUtils.allRoles = function () {';
  const fnStart = src.indexOf(marker);
  if (fnStart === -1) {
    throw new Error('Could not locate UserExtUtils.allRoles in ' + SOURCE_REL);
  }
  const returnIdx = src.indexOf('return', fnStart);
  const openIdx = src.indexOf('[', returnIdx);
  if (openIdx === -1) {
    throw new Error('Could not locate the start of the roles array');
  }

  // Bracket-match from openIdx, ignoring brackets inside strings/comments.
  let depth = 0;
  let i = openIdx;
  let str = null; // current string-quote char, or null
  for (; i < src.length; i++) {
    const ch = src[i];
    const prev = src[i - 1];
    if (str) {
      if (ch === str && prev !== '\\') str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      str = ch;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    throw new Error('Unbalanced brackets while parsing the roles array');
  }

  const arrayText = src.slice(openIdx, i + 1);
  // eslint-disable-next-line no-new-func
  return new Function('return ' + arrayText + ';')();
}

// ---------------------------------------------------------------------------
// 2. Flatten a nested permission tree into ordered [path, value] entries.
// ---------------------------------------------------------------------------

function flatten(obj, prefix, out) {
  Object.keys(obj).forEach(function (key) {
    const val = obj[key];
    const dotPath = prefix ? prefix + '.' + key : key;
    if (val && typeof val === 'object') {
      flatten(val, dotPath, out);
    } else {
      out.push([dotPath, val]);
    }
  });
  return out;
}

function flatMap(tree) {
  const map = {};
  flatten(tree || {}, '', []).forEach(function (entry) {
    map[entry[0]] = entry[1];
  });
  return map;
}

// ---------------------------------------------------------------------------
// 3. Rendering helpers.
// ---------------------------------------------------------------------------

// Decode a rights string into a readable list of capabilities.
const RIGHT_LABELS = {
  r: 'view',
  w: 'edit',
  x: 'run',     // run an action (import / export / propagate / wizard)
  d: 'delete'
};

function decodeRights(value) {
  if (!value) return '';
  return value
    .split('')
    .map(function (c) { return RIGHT_LABELS[c] || c; })
    .join(', ');
}

function cell(value) {
  if (value === undefined) return '·'; // path not defined for this scope/role
  if (value === '') return '-';        // explicitly no access
  return '`' + value + '`';
}

// Split a flat path like "module.legal.settings" into scope + the rest.
function splitScope(dotPath) {
  const idx = dotPath.indexOf('.');
  return {
    scope: dotPath.slice(0, idx),
    rest: dotPath.slice(idx + 1)
  };
}

// Turn "legal.import_template" into "legal › import_template".
function prettyRest(rest) {
  return rest.split('.').join(' › ');
}

// ---------------------------------------------------------------------------
// 4. Build the markdown document.
// ---------------------------------------------------------------------------

function build(roles) {
  const publicRoles = roles.filter(function (r) { return r.permissions; });
  const securedRoles = roles.filter(function (r) { return !r.permissions; });

  // Collect the ordered union of all permission paths, scope by scope, using
  // the first role that defines each scope to fix the ordering.
  const orderedPaths = [];
  const seen = {};
  publicRoles.forEach(function (role) {
    const map = flatMap(role.permissions);
    Object.keys(map).forEach(function (p) {
      if (!seen[p]) { seen[p] = true; orderedPaths.push(p); }
    });
  });

  // Pre-compute the flat base map for each role.
  const baseMaps = {};
  publicRoles.forEach(function (role) {
    baseMaps[role.key] = flatMap(role.permissions);
  });

  const L = [];
  const push = function (s) { L.push(s === undefined ? '' : s); };

  push('<!-- AUTO-GENERATED - DO NOT EDIT BY HAND.');
  push('     Source of truth: ' + SOURCE_REL);
  push('     Regenerate with: node tools/generate-roles-overview.js');
  push('     Kept in sync by: .github/workflows/roles-overview.yml -->');
  push('');
  push('# TrustSource - Roles & Permissions Overview');
  push('');
  push('This document is generated from [`' + SOURCE_REL + '`](' + SOURCE_REL + '). ' +
    'It is a reference for **support staff** to understand which action requires which role.');
  push('');

  // --- Legend ---------------------------------------------------------------
  push('## How to read this document');
  push('');
  push('Every setting carries a short **rights code**. A code is a combination of letters:');
  push('');
  push('| Code | Capability | Meaning |');
  push('|------|------------|---------|');
  push('| `r` | view | The user can **see** the setting / data. |');
  push('| `w` | edit | The user can **change** the value. |');
  push('| `x` | run | The user can **run an action** on it (import, export, propagate, wizard, …). |');
  push('| `d` | delete | The user can **delete** the entry. |');
  push('');
  push('Codes combine, e.g. `rw` = view + edit, `rwd` = view + edit + delete, `rx` = view + run.');
  push('');
  push('| Symbol | Meaning |');
  push('|--------|---------|');
  push('| `-` | Setting exists but the role has **no access** at all (empty rights). |');
  push('| `·` | Setting does **not apply** to this role / scope. |');
  push('');

  // --- Access contexts ------------------------------------------------------
  push('## Access contexts');
  push('');
  push('Permissions are not flat - a role can be **elevated** depending on the user\'s ' +
    'relationship to the specific project or module being viewed. The base tables below ' +
    'show the **default** rights; context elevations are listed per-role afterwards.');
  push('');
  push('| Context | When it applies |');
  push('|---------|-----------------|');
  push('| **Base** | The default rights for the role on any project / module. |');
  push('| **Default owner** (`extendIfDefault`) | Applies to **Manager** and **Compliance manager** when they are the assigned *default project / compliance manager* of the entity - or when no such owner is assigned. |');
  push('| **Member** (`extendIfMember`) | Applies to a **Developer** who is listed in the module\'s members. |');
  push('| **Non-member** (`extendIfNotMember`) | Applies to a **Developer** when the module has members but they are *not* one of them. |');
  push('');

  // --- Role glossary --------------------------------------------------------
  push('## Roles at a glance');
  push('');
  push('| Role | Key | Type | Has permission matrix |');
  push('|------|-----|------|-----------------------|');
  roles.forEach(function (role) {
    const type = role.secured ? 'Internal (secured)' : 'Public';
    const hasMatrix = role.permissions ? 'Yes' : 'No';
    push('| ' + role.label + ' | `' + role.key + '` | ' + type + ' | ' + hasMatrix + ' |');
  });
  push('');
  if (securedRoles.length) {
    push('> **Internal / secured roles** (`' +
      securedRoles.map(function (r) { return r.key; }).join('`, `') +
      '`) are not assignable through the normal role UI and carry no project/module ' +
      'permission matrix in the source. They gate internal tooling only.');
    push('');
  }

  // --- Master matrices, one per scope --------------------------------------
  const scopes = [
    {key: 'project', title: 'Project-level settings'},
    {key: 'module', title: 'Module-level settings'}
  ];

  push('## Permission matrix (base rights)');
  push('');
  push('Columns are roles; rows are settings grouped by area. Cells show the **base** rights code.');
  push('');

  scopes.forEach(function (scope) {
    const scopePaths = orderedPaths.filter(function (p) {
      return splitScope(p).scope === scope.key;
    });
    if (!scopePaths.length) return;

    push('### ' + scope.title);
    push('');

    const header = ['Area › Setting'].concat(publicRoles.map(function (r) { return r.label; }));
    const sep = header.map(function () { return '---'; });
    push('| ' + header.join(' | ') + ' |');
    push('| ' + sep.join(' | ') + ' |');

    let lastArea = null;
    scopePaths.forEach(function (p) {
      const rest = splitScope(p).rest;
      const area = rest.split('.')[0];
      if (area !== lastArea) {
        // Visual area separator row.
        lastArea = area;
      }
      const rowLabel = prettyRest(rest);
      const cells = publicRoles.map(function (r) {
        return cell(baseMaps[r.key][p]);
      });
      push('| ' + ['`' + rowLabel + '`'].concat(cells).join(' | ') + ' |');
    });
    push('');
  });

  // --- Per-role context elevations -----------------------------------------
  push('## Context elevations per role');
  push('');
  push('Only settings that **differ from the base** are listed. If a role has no ' +
    'context elevations, it is noted as such.');
  push('');

  const CONTEXTS = [
    {prop: 'extendIfDefault', title: 'As default owner (`extendIfDefault`)'},
    {prop: 'extendIfMember', title: 'As member (`extendIfMember`)'},
    {prop: 'extendIfNotMember', title: 'As non-member (`extendIfNotMember`)'}
  ];

  publicRoles.forEach(function (role) {
    push('### ' + role.label + ' (`' + role.key + '`)');
    push('');
    const base = baseMaps[role.key];
    let anyContext = false;

    CONTEXTS.forEach(function (ctx) {
      if (!role[ctx.prop]) return;
      anyContext = true;
      const ctxMap = flatMap(role[ctx.prop]);
      const diffs = Object.keys(ctxMap)
        .filter(function (p) { return ctxMap[p] !== base[p]; })
        .sort();
      push('#### ' + ctx.title);
      push('');
      if (!diffs.length) {
        push('_Identical to base rights._');
        push('');
        return;
      }
      push('| Setting | Base | This context |');
      push('|---------|------|--------------|');
      diffs.forEach(function (p) {
        const sp = splitScope(p);
        const label = sp.scope + ' › ' + prettyRest(sp.rest);
        push('| `' + label + '` | ' + cell(base[p]) + ' | ' + cell(ctxMap[p]) + ' |');
      });
      push('');
    });

    if (!anyContext) {
      push('_No context elevations - base rights always apply._');
      push('');
    }
  });

  push('---');
  push('');
  push('_Generated by `tools/generate-roles-overview.js`. Do not edit this file directly; ' +
    'update [`' + SOURCE_REL + '`](' + SOURCE_REL + ') and regenerate._');
  push('');

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 5. Main.
// ---------------------------------------------------------------------------

function main() {
  const checkOnly = process.argv.includes('--check');
  const src = fs.readFileSync(SOURCE, 'utf8');
  const roles = extractRolesArray(src);
  const markdown = build(roles);

  if (checkOnly) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (current !== markdown) {
      process.stderr.write(
        'ROLES_AND_PERMISSIONS.md is out of date.\n' +
        'Run: node tools/generate-roles-overview.js\n'
      );
      process.exit(1);
    }
    process.stdout.write('ROLES_AND_PERMISSIONS.md is up to date.\n');
    return;
  }

  fs.writeFileSync(OUTPUT, markdown, 'utf8');
  process.stdout.write('Wrote ' + path.relative(REPO_ROOT, OUTPUT) + '\n');
}

main();
