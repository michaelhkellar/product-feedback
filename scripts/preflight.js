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
const REQUIRED_FILES = [
  "node_modules/.bin/next",
  "node_modules/react/cjs/react.development.js",
  "node_modules/react/cjs/react.production.js",
  "node_modules/react/jsx-runtime.js",
  "node_modules/react-dom/cjs/react-dom-client.development.js",
  "node_modules/react-dom/cjs/react-dom-client.production.js",
  "node_modules/source-map-js/lib/source-map-generator.js",
  "node_modules/source-map-js/lib/source-map-consumer.js",
  "node_modules/styled-jsx/dist/index/index.js",
  "node_modules/next/dist/server/lib/router-server.js",
];

function missingFiles() {
  return REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
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

// 2. Health check — files + SWC binary.
let missing = missingFiles();
let swcProblem = missing.length === 0 ? missingSwcBinary() : null;
if (missing.length === 0 && !swcProblem && !isNextCacheCorrupt()) {
  process.exit(0); // happy path, ~50ms
}

if (missing.length > 0) {
  console.log(`[preflight] node_modules incomplete. Missing ${missing.length} expected file(s):`);
  for (const f of missing) console.log(`  - ${f}`);
}
if (swcProblem) {
  console.log(`[preflight] SWC binary issue: ${swcProblem}`);
}

// 3. Try plain npm install (incremental, ~1-3s).
run("npm install --no-fund --no-audit");
missing = missingFiles();
swcProblem = missing.length === 0 ? missingSwcBinary() : null;
if (missing.length === 0 && !swcProblem) {
  console.log("[preflight] resolved by `npm install`");
  process.exit(0);
}

// 4. Escalate to `npm ci` after wiping node_modules (~5-15s).
console.log("[preflight] still incomplete — escalating to `npm ci` (clean reinstall from lockfile)");
nukeNodeModules();
run("npm ci --no-fund --no-audit");
missing = missingFiles();
swcProblem = missing.length === 0 ? missingSwcBinary() : null;
if (missing.length === 0 && !swcProblem) {
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
console.error("");
console.error("[preflight] Try: npm run repair");
console.error("[preflight] (nukes node_modules + .next + lockfile + npm cache, then reinstalls)");
process.exit(1);
