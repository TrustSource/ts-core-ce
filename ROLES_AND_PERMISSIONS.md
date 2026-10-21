<!-- AUTO-GENERATED - DO NOT EDIT BY HAND.
     Source of truth: imports/lib/userExtUtils.js
     Regenerate with: node tools/generate-roles-overview.js
     Kept in sync by: .github/workflows/roles-overview.yml -->

# TrustSource - Roles & Permissions Overview

This document is generated from [`imports/lib/userExtUtils.js`](imports/lib/userExtUtils.js). It is a reference for **support staff** to understand which action requires which role.

## How to read this document

Every setting carries a short **rights code**. A code is a combination of letters:

| Code | Capability | Meaning |
|------|------------|---------|
| `r` | view | The user can **see** the setting / data. |
| `w` | edit | The user can **change** the value. |
| `x` | run | The user can **run an action** on it (import, export, propagate, wizard, …). |
| `d` | delete | The user can **delete** the entry. |

Codes combine, e.g. `rw` = view + edit, `rwd` = view + edit + delete, `rx` = view + run.

| Symbol | Meaning |
|--------|---------|
| `-` | Setting exists but the role has **no access** at all (empty rights). |
| `·` | Setting does **not apply** to this role / scope. |

## Access contexts

Permissions are not flat - a role can be **elevated** depending on the user's relationship to the specific project or module being viewed. The base tables below show the **default** rights; context elevations are listed per-role afterwards.

| Context | When it applies |
|---------|-----------------|
| **Base** | The default rights for the role on any project / module. |
| **Default owner** (`extendIfDefault`) | Applies to **Manager** and **Compliance manager** when they are the assigned *default project / compliance manager* of the entity - or when no such owner is assigned. |
| **Member** (`extendIfMember`) | Applies to a **Developer** who is listed in the module's members. |
| **Non-member** (`extendIfNotMember`) | Applies to a **Developer** when the module has members but they are *not* one of them. |

## Roles at a glance

| Role | Key | Type | Has permission matrix |
|------|-----|------|-----------------------|
| Developer | `developer` | Public | Yes |
| Compliance manager | `compliance_manager` | Public | Yes |
| Portfolio manager | `portfolio_manager` | Public | Yes |
| Manager | `manager` | Public | Yes |
| Account admin | `account_admin` | Public | Yes |
| Company component manager | `company_component_manager` | Public | Yes |
| Company security manager | `company_security_manager` | Public | Yes |

## Permission matrix (base rights)

Columns are roles; rows are settings grouped by area. Cells show the **base** rights code.

### Project-level settings

| Area › Setting | Developer | Compliance manager | Portfolio manager | Manager | Account admin | Company component manager | Company security manager |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `general › name` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › description` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › tags` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › leanix` | `r` | `r` | `r` | `r` | `rw` | `r` | `r` |
| `general › relatedUsers › defaultProjectManager` | `r` | `r` | `rw` | `r` | `r` | `r` | `r` |
| `general › relatedUsers › defaultComplianceManager` | `r` | `r` | `rw` | `r` | `r` | `r` | `r` |
| `general › relatedUsers › members` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `legal › settings` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `legal › wizard` | - | - | - | - | - | - | - |
| `legal › import_template` | - | - | - | - | - | - | - |
| `legal › import` | - | - | - | - | - | - | - |
| `legal › propagate` | - | - | - | - | - | - | - |
| `obligationConfig › list` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `obligationConfig › import` | - | - | - | - | - | - | - |
| `obligationConfig › propagate` | - | - | - | - | - | - | - |
| `cia › settings` | `r` | `r` | `r` | `r` | `r` | `r` | `rw` |
| `cia › import` | - | - | - | - | - | - | `rx` |
| `capabilities › settings` | `r` | `r` | `r` | `r` | `r` | `r` | `rw` |
| `capabilities › import` | - | - | - | - | - | - | `rx` |
| `encryption › settings` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `encryption › import` | - | - | - | - | - | - | - |
| `endoflife › settings` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `endoflife › import` | - | - | - | - | - | - | - |
| `quality › settings` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `quality › import` | - | - | - | - | - | - | - |
| `wblist › enforce` | `r` | `rw` | `r` | `r` | `r` | `r` | `r` |
| `wblist › whitelist_license_approve` | - | `rx` | - | - | - | - | - |
| `wblist › whitelist_license` | `r` | `rw` | `r` | `r` | `r` | `r` | `r` |
| `wblist › whitelist_component_approve` | - | `rx` | - | - | - | - | - |
| `wblist › whitelist_component` | `r` | `rw` | `r` | `r` | `r` | `r` | `r` |
| `wblist › blacklist_license` | `r` | `rw` | `r` | `r` | `r` | `r` | `r` |
| `wblist › blacklist_component` | `r` | `rw` | `r` | `r` | `r` | `r` | `r` |
| `issue › switch` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › project` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › jira › switch` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › jira › settings` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › jira › active` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › tfs › settings` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › tfs › active` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › github › settings` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `issue › github › active` | `r` | `r` | `r` | `r` | `rw` | - | - |
| `ModuleImportTab › import` | `r` | `r` | `r` | `r` | - | - | - |
| `danger › delete` | - | - | - | - | - | - | - |

### Module-level settings

| Area › Setting | Developer | Compliance manager | Portfolio manager | Manager | Account admin | Company component manager | Company security manager |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `general › name` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › version` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › description` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › projectId` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › tags` | `rw` | `r` | `rw` | `r` | `r` | `r` | `r` |
| `general › leanix` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › moduleIdentifier` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › architectureType` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › relatedUsers › defaultProjectManager` | `r` | `r` | `rw` | `r` | `r` | `r` | `r` |
| `general › relatedUsers › defaultComplianceManager` | `r` | `r` | `rw` | `r` | `r` | `r` | `r` |
| `general › relatedUsers › members` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `general › properties › privacy` | `r` | `r` | `r` | `r` | `r` | `r` | `r` |
| `legal › settings` | `r` | `r` | `r` | `r` | - | - | - |
| `legal › project` | `r` | `r` | `r` | `r` | - | - | - |
| `legal › wizard` | - | - | - | - | - | - | - |
| `legal › import_template` | - | - | - | - | - | - | - |
| `legal › import_project` | - | - | - | - | - | - | - |
| `legal › propagate` | - | - | - | - | - | - | - |
| `obligationConfig › list` | `r` | `r` | `r` | `r` | - | - | - |
| `obligationConfig › project` | `r` | `r` | `r` | `r` | - | - | - |
| `obligationConfig › import` | - | - | - | - | - | - | - |
| `obligationConfig › propagate` | - | - | - | - | - | - | - |
| `viability › viabilityConfig › enabled` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `viability › import` | `rx` | - | - | - | - | - | - |
| `viability › warningThreshold` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `viability › violationThreshold` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `viability › minConfidence` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `viability › noInfoLevel` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `versioning › versioningConfig › enabled` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `versioning › jump` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `versioning › import` | `rx` | - | - | - | - | - | - |
| `versioning › warningThreshold` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `versioning › violationThreshold` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `cia › settings` | `rw` | `r` | `r` | `r` | `r` | `r` | `rw` |
| `cia › import` | `rx` | - | - | - | - | - | `rx` |
| `capabilities › settings` | `rw` | `rw` | `rw` | `rw` | `r` | `r` | `rw` |
| `capabilities › import` | `rx` | `rx` | `rx` | `rx` | - | - | `rx` |
| `encryption › settings` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `encryption › import` | `rx` | - | - | - | - | - | - |
| `endoflife › settings` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `endoflife › import` | `rx` | - | - | - | - | - | - |
| `quality › settings` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `quality › import` | `rx` | - | - | - | - | - | - |
| `releases › analysis` | `r` | `r` | `r` | `r` | - | - | - |
| `releases › scans` | `r` | `r` | `r` | `r` | - | - | - |
| `wblist › whitelist_license_approve` | - | - | - | - | - | - | - |
| `wblist › whitelist_license` | `rw` | `r` | `r` | `r` | - | - | - |
| `wblist › whitelist_component_approve` | - | - | - | - | - | - | - |
| `wblist › whitelist_component` | `rw` | `r` | `r` | `r` | - | - | - |
| `wblist › blacklist_license` | `rw` | `r` | `r` | `r` | - | - | - |
| `wblist › blacklist_component` | `rw` | `r` | `r` | `r` | - | - | - |
| `cveWhitelist › list` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `customComponents › settings` | `rw` | `r` | `r` | `r` | `r` | `r` | `r` |
| `SPDXExportTab › export` | `rx` | `rx` | `rx` | `rx` | - | - | - |
| `danger › delete` | `rx` | - | - | - | - | - | - |
| `danger › delete_history` | `rx` | - | - | - | - | - | - |

## Context elevations per role

Only settings that **differ from the base** are listed. If a role has no context elevations, it is noted as such.

### Developer (`developer`)

#### As member (`extendIfMember`)

| Setting | Base | This context |
|---------|------|--------------|
| `module › general › leanix` | `r` | `rw` |

#### As non-member (`extendIfNotMember`)

| Setting | Base | This context |
|---------|------|--------------|
| `module › SPDXExportTab › export` | `rx` | `r` |
| `module › capabilities › import` | `rx` | `r` |
| `module › capabilities › settings` | `rw` | `r` |
| `module › cia › import` | `rx` | `r` |
| `module › cia › settings` | `rw` | `r` |
| `module › customComponents › settings` | `rw` | `r` |
| `module › cveWhitelist › list` | `rw` | `r` |
| `module › danger › delete` | `rx` | - |
| `module › danger › delete_history` | `rx` | - |
| `module › encryption › import` | `rx` | `r` |
| `module › encryption › settings` | `rw` | `r` |
| `module › endoflife › import` | `rx` | `r` |
| `module › endoflife › settings` | `rw` | `r` |
| `module › general › description` | `rw` | `r` |
| `module › general › name` | `rw` | `r` |
| `module › general › projectId` | `rw` | `r` |
| `module › general › tags` | `rw` | `r` |
| `module › general › version` | `rw` | `r` |
| `module › quality › import` | `rx` | `r` |
| `module › quality › settings` | `rw` | `r` |
| `module › versioning › import` | `rx` | `r` |
| `module › versioning › jump` | `rw` | `r` |
| `module › versioning › versioningConfig › enabled` | `rw` | `r` |
| `module › versioning › violationThreshold` | `rw` | `r` |
| `module › versioning › warningThreshold` | `rw` | `r` |
| `module › viability › import` | `rx` | `r` |
| `module › viability › minConfidence` | `rw` | `r` |
| `module › viability › noInfoLevel` | `rw` | `r` |
| `module › viability › viabilityConfig › enabled` | `rw` | `r` |
| `module › viability › violationThreshold` | `rw` | `r` |
| `module › viability › warningThreshold` | `rw` | `r` |
| `module › wblist › blacklist_component` | `rw` | `r` |
| `module › wblist › blacklist_license` | `rw` | `r` |
| `module › wblist › whitelist_component` | `rw` | `r` |
| `module › wblist › whitelist_license` | `rw` | `r` |

### Compliance manager (`compliance_manager`)

#### As default owner (`extendIfDefault`)

| Setting | Base | This context |
|---------|------|--------------|
| `module › cia › import` | - | `rx` |
| `module › cia › settings` | `r` | `rw` |
| `module › customComponents › settings` | `r` | `rwd` |
| `module › cveWhitelist › list` | `r` | `rwd` |
| `module › encryption › import` | - | `rx` |
| `module › encryption › settings` | `r` | `rw` |
| `module › endoflife › import` | - | `rx` |
| `module › endoflife › settings` | `r` | `rw` |
| `module › general › architectureType` | `r` | `rw` |
| `module › general › projectId` | `r` | `rw` |
| `module › general › properties › privacy` | `r` | `rw` |
| `module › general › relatedUsers › defaultComplianceManager` | `r` | `rw` |
| `module › general › relatedUsers › defaultProjectManager` | `r` | `rw` |
| `module › general › relatedUsers › members` | `r` | `rw` |
| `module › general › tags` | `r` | `rw` |
| `module › legal › import_project` | - | `rx` |
| `module › legal › import_template` | - | `rx` |
| `module › legal › project` | `r` | `rw` |
| `module › legal › propagate` | - | `rx` |
| `module › legal › settings` | `r` | `rw` |
| `module › legal › wizard` | - | `rx` |
| `module › obligationConfig › import` | - | `rx` |
| `module › obligationConfig › list` | `r` | `rw` |
| `module › obligationConfig › propagate` | - | `rx` |
| `module › quality › import` | - | `rx` |
| `module › quality › settings` | `r` | `rw` |
| `module › releases › analysis` | `r` | `rwd` |
| `module › versioning › import` | - | `rx` |
| `module › versioning › jump` | `r` | `rw` |
| `module › versioning › versioningConfig › enabled` | `r` | `rw` |
| `module › versioning › violationThreshold` | `r` | `rw` |
| `module › versioning › warningThreshold` | `r` | `rw` |
| `module › viability › import` | - | `rx` |
| `module › viability › minConfidence` | `r` | `rw` |
| `module › viability › noInfoLevel` | `r` | `rw` |
| `module › viability › viabilityConfig › enabled` | `r` | `rw` |
| `module › viability › violationThreshold` | `r` | `rw` |
| `module › viability › warningThreshold` | `r` | `rw` |
| `module › wblist › blacklist_component` | `r` | `rwd` |
| `module › wblist › blacklist_license` | `r` | `rwd` |
| `module › wblist › whitelist_component` | `r` | `rwd` |
| `module › wblist › whitelist_component_approve` | - | `rx` |
| `module › wblist › whitelist_license` | `r` | `rwd` |
| `module › wblist › whitelist_license_approve` | - | `rx` |
| `project › ModuleImportTab › import` | `r` | `rx` |
| `project › general › description` | `r` | `rw` |
| `project › general › name` | `r` | `rw` |
| `project › general › relatedUsers › defaultComplianceManager` | `r` | `rw` |
| `project › general › relatedUsers › defaultProjectManager` | `r` | `rw` |
| `project › general › relatedUsers › members` | `r` | `rw` |
| `project › general › tags` | `r` | `rw` |
| `project › legal › import` | - | `rx` |
| `project › legal › import_template` | - | `rx` |
| `project › legal › propagate` | - | `rx` |
| `project › legal › settings` | `r` | `rw` |
| `project › legal › wizard` | - | `rx` |
| `project › obligationConfig › import` | - | `rx` |
| `project › obligationConfig › list` | `r` | `rw` |
| `project › obligationConfig › propagate` | - | `rx` |

### Portfolio manager (`portfolio_manager`)

_No context elevations - base rights always apply._

### Manager (`manager`)

#### As default owner (`extendIfDefault`)

| Setting | Base | This context |
|---------|------|--------------|
| `module › cia › import` | - | `rx` |
| `module › cia › settings` | `r` | `rw` |
| `module › customComponents › settings` | `r` | `rwd` |
| `module › cveWhitelist › list` | `r` | `rwd` |
| `module › danger › delete` | - | `rx` |
| `module › danger › delete_history` | - | `rx` |
| `module › encryption › import` | - | `rx` |
| `module › encryption › settings` | `r` | `rw` |
| `module › endoflife › import` | - | `rx` |
| `module › endoflife › settings` | `r` | `rw` |
| `module › general › architectureType` | `r` | `rw` |
| `module › general › description` | `r` | `rw` |
| `module › general › leanix` | `r` | `rw` |
| `module › general › name` | `r` | `rw` |
| `module › general › projectId` | `r` | `rw` |
| `module › general › properties › privacy` | `r` | `rw` |
| `module › general › relatedUsers › defaultComplianceManager` | `r` | `rw` |
| `module › general › relatedUsers › defaultProjectManager` | `r` | `rw` |
| `module › general › relatedUsers › members` | `r` | `rw` |
| `module › general › tags` | `r` | `rwd` |
| `module › general › version` | `r` | `rw` |
| `module › legal › import_project` | - | `rx` |
| `module › legal › import_template` | - | `rx` |
| `module › legal › project` | `r` | `rw` |
| `module › legal › propagate` | - | `rx` |
| `module › legal › settings` | `r` | `rw` |
| `module › legal › wizard` | - | `rx` |
| `module › obligationConfig › import` | - | `rx` |
| `module › obligationConfig › list` | `r` | `rw` |
| `module › obligationConfig › project` | `r` | `rw` |
| `module › obligationConfig › propagate` | - | `rx` |
| `module › quality › import` | - | `rx` |
| `module › quality › settings` | `r` | `rw` |
| `module › releases › analysis` | `r` | `rwd` |
| `module › versioning › import` | - | `rx` |
| `module › versioning › jump` | `r` | `rw` |
| `module › versioning › versioningConfig › enabled` | `r` | `rw` |
| `module › versioning › violationThreshold` | `r` | `rw` |
| `module › versioning › warningThreshold` | `r` | `rw` |
| `module › viability › import` | - | `rx` |
| `module › viability › minConfidence` | `r` | `rw` |
| `module › viability › noInfoLevel` | `r` | `rw` |
| `module › viability › viabilityConfig › enabled` | `r` | `rw` |
| `module › viability › violationThreshold` | `r` | `rw` |
| `module › viability › warningThreshold` | `r` | `rw` |
| `module › wblist › blacklist_component` | `r` | `rwd` |
| `module › wblist › blacklist_license` | `r` | `rwd` |
| `module › wblist › whitelist_component` | `r` | `rwd` |
| `module › wblist › whitelist_license` | `r` | `rwd` |
| `project › ModuleImportTab › import` | `r` | `rx` |
| `project › capabilities › import` | - | `rx` |
| `project › capabilities › settings` | `r` | `rw` |
| `project › cia › import` | - | `rx` |
| `project › cia › settings` | `r` | `rw` |
| `project › danger › delete` | - | `rx` |
| `project › encryption › import` | - | `rx` |
| `project › encryption › settings` | `r` | `rw` |
| `project › endoflife › import` | - | `rx` |
| `project › endoflife › settings` | `r` | `rw` |
| `project › general › description` | `r` | `rw` |
| `project › general › leanix` | `r` | `rw` |
| `project › general › name` | `r` | `rw` |
| `project › general › relatedUsers › defaultComplianceManager` | `r` | `rw` |
| `project › general › relatedUsers › defaultProjectManager` | `r` | `rw` |
| `project › general › relatedUsers › members` | `r` | `rw` |
| `project › general › tags` | `r` | `rw` |
| `project › issue › github › active` | `r` | `rw` |
| `project › issue › github › settings` | `r` | `rw` |
| `project › issue › jira › active` | `r` | `rw` |
| `project › issue › jira › settings` | `r` | `rw` |
| `project › issue › jira › switch` | `r` | `rw` |
| `project › issue › project` | `r` | `rw` |
| `project › issue › switch` | `r` | `rw` |
| `project › issue › tfs › active` | `r` | `rw` |
| `project › issue › tfs › settings` | `r` | `rw` |
| `project › legal › import` | - | `rx` |
| `project › legal › import_template` | - | `rx` |
| `project › legal › propagate` | - | `rx` |
| `project › legal › settings` | `r` | `rw` |
| `project › legal › wizard` | - | `rx` |
| `project › obligationConfig › import` | - | `rx` |
| `project › obligationConfig › list` | `r` | `rw` |
| `project › obligationConfig › propagate` | - | `rx` |
| `project › quality › import` | - | `rx` |
| `project › quality › settings` | `r` | `rw` |
| `project › wblist › blacklist_component` | `r` | `rw` |
| `project › wblist › blacklist_license` | `r` | `rw` |
| `project › wblist › enforce` | `r` | `rw` |
| `project › wblist › whitelist_component` | `r` | `rw` |
| `project › wblist › whitelist_component_approve` | - | `rx` |
| `project › wblist › whitelist_license` | `r` | `rw` |
| `project › wblist › whitelist_license_approve` | - | `rx` |

### Account admin (`account_admin`)

_No context elevations - base rights always apply._

### Company component manager (`company_component_manager`)

_No context elevations - base rights always apply._

### Company security manager (`company_security_manager`)

_No context elevations - base rights always apply._

---

_Generated by `tools/generate-roles-overview.js`. Do not edit this file directly; update [`imports/lib/userExtUtils.js`](imports/lib/userExtUtils.js) and regenerate._
