/**
 * Patches meteor-node-stubs/map.json to add missing Node built-in stubs
 * that server-only packages reference in browser bundles.
 * Also replaces vulnerable bundled dependencies (shipped inside the
 * meteor-node-stubs tarball, immune to yarn resolutions) with the patched
 * hoisted versions.
 * Run via postinstall script.
 */
const fs = require('fs');
const path = require('path');

const mapPath = path.join(__dirname, '..', 'node_modules', 'meteor-node-stubs', 'map.json');

if (!fs.existsSync(mapPath)) {
  console.log('[patch-node-stubs] meteor-node-stubs not found, skipping');
} else {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

  const stubs = {
    'http2': null,
    'async_hooks': null,
    'fs/promises': null,
    'perf_hooks': null,
    'inspector': null,
    'path/posix': null,
    'path/win32': null
  };

  let changed = false;
  for (const [key, value] of Object.entries(stubs)) {
    if (!(key in map)) {
      map[key] = value;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n');
    console.log('[patch-node-stubs] Added missing Node built-in stubs to meteor-node-stubs/map.json');
  } else {
    console.log('[patch-node-stubs] All stubs already present');
  }
}

// Replace vulnerable bundled copies with the patched hoisted versions
// (resolutions in package.json keep the hoisted copies at safe versions).
const bundledOverrides = ['qs', 'bn.js', 'pbkdf2'];
for (const pkg of bundledOverrides) {
  const bundledDir = path.join(__dirname, '..', 'node_modules', 'meteor-node-stubs', 'node_modules', pkg);
  const hoistedDir = path.join(__dirname, '..', 'node_modules', pkg);
  if (!fs.existsSync(bundledDir) || !fs.existsSync(hoistedDir)) continue;
  const bundledVersion = JSON.parse(fs.readFileSync(path.join(bundledDir, 'package.json'), 'utf8')).version;
  const hoistedVersion = JSON.parse(fs.readFileSync(path.join(hoistedDir, 'package.json'), 'utf8')).version;
  if (bundledVersion === hoistedVersion) continue;
  fs.rmSync(bundledDir, { recursive: true, force: true });
  fs.cpSync(hoistedDir, bundledDir, { recursive: true });
  console.log(`[patch-node-stubs] Replaced bundled ${pkg}@${bundledVersion} with hoisted ${pkg}@${hoistedVersion}`);
}
