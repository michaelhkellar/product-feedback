#!/usr/bin/env node
/**
 * Preflight check that runs before `npm run dev` and `npm run build`.
 *
 * Catches the startup failure modes we've actually hit:
 *   - Partial node_modules: a package directory exists but a sub-folder of files
 *     is silently missing ("Cannot find module './cjs/react.development.js'",
 *     "Cannot find module './lib/source-map-generator'").
 *   - Stale `.next` build cache from a previous failed run, which can manifest as
 *     missing webpack chunks or missing build manifest.
 *   - Missing SWC native binary for the host platform after install.
 *   - Wrong Node version (Next 15 requires >=18.18).
 *
 * Strategy: cheap & silent when everything is healthy (~50ms). When something is
 * broken, escalate from "fix it cheaply" to "nuke and reinstall" to "tell the user
 * to run repair", logging clearly at each step.
 *
 * Keep this script dependency-free — it runs before `npm install` completes.
 */
const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const os = require("os");

const ROOT = process.cwd();

// ---------- Health checks ----------

const REQUIRED_NODE_MAJOR = 18;
const REQUIRED_NODE_MINOR = 18;

function checkNodeVersion() {
  const m = process.versions.node.match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  const [, major, minor] = m.map(Number);
  if (major < REQUIRED_NODE_MAJOR || (major === REQUIRED_NODE_MAJOR && minor < REQUIRED_NODE_MINOR)) {
    return `Node ${process.versions.node} is too old — Next 15 requires >=${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}.0`;
  }
  return null;
}

// Critical files we expect after a clean install. Partial extracts often leave the
// package.json in place but drop sub-folders silently — that's why we check deep files.
// Add new entries here when a new corruption mode surfaces in the wild.
const REQUIRED_FILES = [
  // Next.js core + SWC chain
  "node_modules/.bin/next",
  "node_modules/next/dist/server/lib/router-server.js",
  // React runtime
  "node_modules/react/cjs/react.development.js",
  "node_modules/react/cjs/react.production.js",
  "node_modules/react/jsx-runtime.js",
  "node_modules/react-dom/cjs/react-dom-client.development.js",
  "node_modules/react-dom/cjs/react-dom-client.production.js",
  // Source-map machinery (used by both webpack and postcss)
  "node_modules/source-map-js/lib/source-map-generator.js",
  "node_modules/source-map-js/lib/source-map-consumer.js",
  // styled-jsx
  "node_modules/styled-jsx/dist/index/index.js",
  // CSS build chain (postcss → tailwindcss → autoprefixer). All three have hit
  // partial-extract corruption in the wild, manifesting as cryptic webpack errors
  // like "Cannot find module '/.../tailwindcss/lib/index.js'".
  "node_modules/postcss/lib/postcss.js",
  "node_modules/tailwindcss/lib/index.js",
  "node_modules/autoprefixer/lib/autoprefixer.js",
  // jiti (TypeScript runtime) — pulled in transitively by tailwindcss; hit corruption
  // in the form "Cannot find module '/.../jiti/lib/index.js'" during dev.
  "node_modules/jiti/lib/index.js",
];

function missingFiles() {
  return REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
}

/**
 * Systematic check: for every top-level package in node_modules, verify its
 * advertised `main` entry actually exists on disk. Catches the long tail of
 * partial-extract corruption that a static spot-check list can't anticipate
 * (e.g. transitive deps like jiti getting half-extracted).
 *
 * Cheap to run — ~300 existsSync calls, each microseconds. Returns the first
 * 5 broken packages so logs stay readable when something's wrong.
 */
function findBrokenPackages(maxReport = 5) {
  const broken = [];
  const modulesDir = path.join(ROOT, "node_modules");
  if (!fs.existsSync(modulesDir)) return broken;
  let entries;
  try {
    entries = fs.readdirSync(modulesDir, { withFileTypes: true });
  } catch {
    return broken;
  }
  for (const entry of entries) {
    if (broken.length >= maxReport) break;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      // Scoped packages: descend one level
      let scoped;
      try {
        scoped = fs.readdirSync(path.join(modulesDir, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of scoped) {
        if (broken.length >= maxReport) break;
        if (!s.isDirectory()) continue;
        const result = checkPackageMain(modulesDir, `${entry.name}/${s.name}`);
        if (result) broken.push(result);
      }
    } else {
      const result = checkPackageMain(modulesDir, entry.name);
      if (result) broken.push(result);
    }
  }
  return broken;
}

/**
 * Resolve a package's `main` entry the way Node's loader does:
 * try the literal path, then path + .js / .cjs / .mjs / .json,
 * then path/index.js / index.cjs / index.mjs / index.json.
 * Returns true if any candidate exists. Avoids false positives from packages
 * that declare `main: "index"` or `main: "dist/foo"` (no extension).
 */
function mainEntryExists(basePath) {
  const candidates = [
    basePath,
    basePath + ".js",
    basePath + ".cjs",
    basePath + ".mjs",
    basePath + ".json",
    path.join(basePath, "index.js"),
    path.join(basePath, "index.cjs"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.json"),
  ];
  return candidates.some((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

function checkPackageMain(modulesDir, pkgName) {
  const pkgDir = path.join(modulesDir, pkgName);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null; // not a real package, skip
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return null;
  }
  // Only check `main`. `exports` is more complex and many packages don't ship a
  // file at the resolved path until require()'d — false positives aren't worth it.
  if (!pkg.main || typeof pkg.main !== "string") return null;
  const mainPath = path.join(pkgDir, pkg.main);
  if (mainEntryExists(mainPath)) return null;
  return { pkg: pkgName, missing: path.relative(ROOT, mainPath) };
}

// Next ships its SWC compiler as platform-specific native binaries. If the wrong
// one (or none) is installed, Next falls back to babel and complains loudly OR
// fails outright. Check for any matching binary for this platform/arch.
function missingSwcBinary() {
  const platform = os.platform(); // "darwin" | "linux" | "win32"
  const arch = os.arch();         // "arm64" | "x64"
  const dir = path.join(ROOT, "node_modules", "@next");
  if (!fs.existsSync(dir)) return `node_modules/@next not present`;
  const expected = `swc-${platform}-${arch}`; // e.g. "swc-darwin-arm64"
  const variants = fs.readdirSync(dir).filter((d) => d.startsWith("swc-"));
  if (variants.length === 0) return `no @next/swc-* binary installed`;
  const match = variants.some((v) => v === expected || v.startsWith(expected + "-"));
  if (!match) return `no SWC binary for ${platform}/${arch} (have: ${variants.join(", ")})`;
  return null;
}

// `.next` can rot between dev runs — incomplete builds, swap files, etc. The cheapest
// signal of corruption is "the directory exists but the trace files don't".
// Detection only — we don't auto-delete .next here because doing so for a healthy build
// would be wasteful. The repair script handles the nuke case.
function isNextCacheCorrupt() {
  const next = path.join(ROOT, ".next");
  if (!fs.existsSync(next)) return false; // no cache yet — fine
  // After a successful `next build`, BUILD_ID exists. After dev runs, it may not.
  // The reliable corruption signal: the directory exists, has subfolders, but trace.* files
  // suggest something else interrupted things. We err on the side of leaving it alone.
  // Keep this hook in case future modes appear.
  return false;
}

// ---------- Heal steps ----------

function run(cmd) {
  console.log(`[preflight] ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

function nukeNodeModules() {
  try {
    fs.rmSync(path.join(ROOT, "node_modules"), { recursive: true, force: true });
  } catch (err) {
    console.warn(`[preflight] could not remove node_modules: ${err.message}`);
  }
}

// ---------- Main ----------

// 1. Node version is non-negotiable — fail loudly.
const nodeProblem = checkNodeVersion();
if (nodeProblem) {
  console.error(`[preflight] ${nodeProblem}`);
  console.error(`[preflight] install a newer Node (e.g. via fnm, nvm, or homebrew) and retry.`);
  process.exit(1);
}

// 2. Health check — files + SWC binary + systematic main-entry walk.
let missing = missingFiles();
let swcProblem = missing.length === 0 ? missingSwcBinary() : null;
let brokenPkgs = (missing.length === 0 && !swcProblem) ? findBrokenPackages() : [];
if (missing.length === 0 && !swcProblem && brokenPkgs.length === 0 && !isNextCacheCorrupt()) {
  process.exit(0); // happy path, ~50-150ms
}

if (missing.length > 0) {
  console.log(`[preflight] node_modules incomplete. Missing ${missing.length} expected file(s):`);
  for (const f of missing) console.log(`  - ${f}`);
}
if (swcProblem) {
  console.log(`[preflight] SWC binary issue: ${swcProblem}`);
}
if (brokenPkgs.length > 0) {
  console.log(`[preflight] ${brokenPkgs.length} package(s) have a broken "main" entry (partial extract):`);
  for (const b of brokenPkgs) console.log(`  - ${b.pkg}: missing ${b.missing}`);
}

// 3. Try plain npm install (incremental, ~1-3s).
run("npm install --no-fund --no-audit");
missing = missingFiles();
swcProblem = missing.length === 0 ? missingSwcBinary() : null;
brokenPkgs = findBrokenPackages();
if (missing.length === 0 && !swcProblem && brokenPkgs.length === 0) {
  console.log("[preflight] resolved by `npm install`");
  process.exit(0);
}

// 4. Escalate to `npm ci` after wiping node_modules (~5-15s).
console.log("[preflight] still incomplete — escalating to `npm ci` (clean reinstall from lockfile)");
nukeNodeModules();
run("npm ci --no-fund --no-audit");
missing = missingFiles();
swcProblem = missing.length === 0 ? missingSwcBinary() : null;
brokenPkgs = (missing.length === 0 && !swcProblem) ? findBrokenPackages() : [];
if (missing.length === 0 && !swcProblem && brokenPkgs.length === 0) {
  console.log("[preflight] resolved by `npm ci`");
  process.exit(0);
}

// 5. Surface for `npm run repair` (nukes lockfile + cache too).
console.error("[preflight] still broken after `npm ci`.");
if (missing.length > 0) {
  console.error("[preflight] Missing files:");
  for (const f of missing) console.error(`  - ${f}`);
}
if (swcProblem) console.error(`[preflight] ${swcProblem}`);
if (brokenPkgs.length > 0) {
  console.error("[preflight] Packages with broken main entries:");
  for (const b of brokenPkgs) console.error(`  - ${b.pkg}: missing ${b.missing}`);
}
console.error("");
console.error("[preflight] Try: npm run repair");
console.error("[preflight] (nukes node_modules + .next + lockfile + npm cache, then reinstalls)");
console.error("[preflight] If `npm run repair` doesn't fix it either, the underlying issue is a poisoned");
console.error("[preflight] global npm cache. Run: npm cache clean --force (then npm install)");
process.exit(1);
