# CycloneDX 1.7 — Manual Test

Fixture: [`test-cydx-1.7-crypto.json`](./test-cydx-1.7-crypto.json) — a schema-valid CycloneDX **1.7** CBOM
that exercises everything added in the `feature/cyclonedx-1.7-core` branch:

- **Version gate** — 1.7 is accepted (previously fell through to `private`).
- **Enriched component mapping** — root carries `supplier`, `author`, `copyright`, `group`,
  `cpe`, a checksum, and all six `externalReferences` types (website/vcs/distribution/
  issue-tracker/mailing-list/documentation).
- **Dependency graph** — `cydx17-demo-app` → `left-pad`, `spring-core`.
- **Crypto round-trip** — one `cryptographic-asset` of each of the four asset types
  (`algorithm`, `certificate`, `protocol`, `related-crypto-material`). Each is **graph-linked**
  to the root component via a `dependencies` edge (`cydx17-demo-app` `dependsOn` the crypto
  `bom-ref`s), so they attach to the component as `crypto_algorithms`.

> **Crypto linkage rule:** a crypto asset is attached to a component only when the
> `dependencies` graph links them (`component dependsOn crypto-bom-ref`). Crypto assets that
> are not referenced by any component stay module-level only and do not appear on a component.

## 1. Import via REST

```bash
curl -i -X POST \
  'http://localhost:3000/api/v2/core/imports/scan/cyclonedx?project=CydxDemo&module=cydx17-demo-app' \
  -H 'x-api-key: <YOUR_API_KEY>' \
  -H 'Content-Type: application/json' \
  --data-binary @tests/cydx/test-cydx-1.7-crypto.json
```

- Get an API key from **Settings → Company → API Keys**.
- Required query param: `project`. Optional: `module`, `branch`, `tag`, `pkgType`, `version`.
- Expected: **201 Created** with a body containing a `moduleId`.

> Note: an async `TSAnalysisError: 404 Scan for module … was not found` may appear in the
> server log afterward. That is the external **ts-analysis** lambda (deep-scan enrichment),
> which is typically unavailable in local dev — it does **not** affect the import, the
> created module, or the persisted crypto assets.

## 2. Verify in the UI

1. Open the project → module (named after the file on UI import, or `cydx17-demo-app` on
   REST import with `?module=cydx17-demo-app`).
2. **Dependencies** — `left-pad` and `spring-core` appear under the root; the root shows the
   enriched metadata (homepage, repo, copyright, supplier, etc.) and a **CRYPTO ALGORITHMS**
   property listing the four linked assets (AES-256-GCM, acme.test TLS certificate, TLS 1.3,
   Release signing private key). This works for **both** the UI and REST import paths.
3. **Settings → Cryptographic Assets** — the four assets are listed with their asset-type
   column. This is populated by **both** the REST import endpoint
   (`/api/v2/core/imports/scan/cyclonedx`) and the UI `/scan-import` path - both now persist the
   imported crypto assets to the Settings → Crypto list (in addition to the component-level
   `crypto_algorithms` in step 2).
   | Name | Asset type |
   |------|-----------|
   | AES-256-GCM | algorithm |
   | acme.test TLS certificate | certificate |
   | TLS 1.3 | protocol |
   | Release signing private key | related-crypto-material |

## 3. Round-trip (export → re-import)

1. Export the module as a CycloneDX **CBOM** (JSON). The output is `specVersion: "1.7"` and
   re-emits the four crypto assets.
2. Re-import that exported file with the same `curl` as step 1.
3. Confirm the crypto assets reappear unchanged — this is the lossless round-trip.

## 4. Quick offline check (no running server)

Parse + schema-validate the fixture directly:

```bash
node -e '
const {validateCycloneDX} = require("./test_api/helpers/cyclonedxValidate");
const reader = require("./imports/lib/cyclonedx/reader");
const bom = require("./tests/cydx/test-cydx-1.7-crypto.json");
console.log("schema:", validateCycloneDX(bom).length ? validateCycloneDX(bom) : "VALID");
const {scan, crypto} = reader.parseBom(bom, {query: {project: "CydxDemo"}});
console.log("root:", scan.dependencies[0].name, "| deps:", scan.dependencies[0].dependencies.map(d=>d.name));
console.log("crypto:", crypto.map(c=>c.name+" ("+c.assetType+")"));
'
```

Expected: `schema: VALID`, the dependency tree, and the four named crypto assets.

## Legacy versions

The reader still accepts 1.2–1.6. The existing fixtures in this folder
(`test-cydx.json`, `test-cydx-pkg-types.json`, …) import unchanged through the same endpoint.
