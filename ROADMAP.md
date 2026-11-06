# Roadmap

These are the features planned for TrustSource Community Edition. Features are built in
quarterly sprints. The versions follow the scheme in the README: the major number counts
years (2026 = 1, 2027 = 2, 2028 = 3), the minor number counts sprints within the year
starting at 0, and the patch number counts fixes.

Target dates are plans, not promises. Feature requests from issues are reviewed every
sprint and may be added or reordered.

| Sprint | Version | Feature |
|--------|---------|---------|
| Sep - Oct 2026 | 1.0.0 - 1.0.3 | First CE release (done) |
| Dec 2026 | 1.1.0 | Registry (index API) |
| Mar 2027 | 2.0.0 | Deep scan |
| Jun 2027 | 2.1.0 | Mass scans |
| Sep 2027 | 2.2.0 | Algorithms |
| Dec 2027 | 2.3.0 | OBOM |
| Mar 2028 | 3.0.0 | IDM |

## 1.1.0 - Registry (index API)

Search public package registries (npm, Maven, PyPI, Go, Cargo, NuGet, Gradle, Dart, Swift,
CRAN) by name or purl from the Component Lake. Package and version pages show licenses,
homepage, repository, checksums and known vulnerabilities. A new component can be
pre-filled from a search result. Today the CE catalogue only grows from imported scans
and manual entries.

## 2.0.0 - Deep scan

Source-level scan of a Git repository or a single file, without a build. It finds licenses
and copyrights per file, which also finds vendored or copied code. It can add a crypto
inventory. Files can be approved or rejected with comments. Scan history, rescans and a
REST API are included. The deep scan service will be self-hostable or connectable.

## 2.1.0 - Mass scans

Deep scan for every component version of a module analysis in one run, up to 500. It
compares declared and found licenses and copyrights, shows statistics and exports CSV.

## 2.2.0 - Algorithms

A curated catalogue of cryptographic algorithms with post-quantum safety rating, strength,
substitutes, references and standards. It is used by the existing CBOM export, the
algorithm reports and the crypto deny policy.

## 2.3.0 - OBOM

Operational BOM: what actually runs per deployment (containers, platforms, runtimes). It is
uploaded with ts-scan or the API. It adds an OBOM tab to the module, a comparison of
deployments, and findings that can become risks.

## 3.0.0 - IDM

Sign in with LDAP, SAML 2.0, OpenID Connect or social logins, with an option to enforce SSO.

## Ask for a feature

Open an issue with the feature request template. See [SUPPORT.md](SUPPORT.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).
