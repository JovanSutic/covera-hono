#!/usr/bin/env node
/**
 * The single verification command for this repo.
 *
 *   npm run gate            typecheck + lint + tests + structural invariants
 *   npm run gate -- --openapi   also boot the app and check the OpenAPI document
 *
 * Designed to replace prose acceptance criteria in plan files: every check prints one line and
 * the process exits non-zero on the first failure, so a plan step can say "Accept: npm run gate"
 * and the result is machine-checkable rather than "looks right".
 *
 * Output discipline: one line per check on success. Full command output only on failure, tailed,
 * so a failing step shows the error and a passing step costs almost nothing in tokens.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const OPENAPI = process.argv.includes("--openapi");

/** Structural invariants from docs/errorHandle.md §0.3 / §7.4. */
const RULES = [
  {
    name: "one envelope: no hand-built `success: false`",
    // Legitimate builders: the renderer, the OpenAPI example factory, and tests.
    allow: (f) => f.startsWith("src/core/errors/") || f.endsWith(".test.ts"),
    pattern: /success:\s*false/g,
  },
  {
    name: "guards/middleware throw, never format",
    allow: (f) => f.endsWith(".test.ts"),
    dir: "src/middleware",
    pattern: /\bc\.json\s*\(/g,
  },
  {
    name: "no legacy error helper",
    allow: (f) => f.startsWith("src/docs/"),
    pattern: /\b(getStandardResponses|commonErrors|error\.helpers)\b/g,
  },
  {
    name: "no bare `new Error(`",
    allow: (f) => f.startsWith("src/core/errors/") || f.endsWith(".test.ts"),
    pattern: /\bnew Error\s*\(/g,
  },
  {
    name: "no test-local onError override",
    allow: () => false,
    filesOnly: (f) => f.startsWith("src/modules/") && f.endsWith(".test.ts"),
    pattern: /\.onError\s*\(/g,
  },
];

const failures = [];

const run = (label, cmd) => {
  const started = Date.now();
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: "pipe", timeout: 600_000 });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ok    ${label} (${secs}s)`);
    return { ok: true, out };
  } catch (err) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const raw = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    const tail = raw.split("\n").slice(-25).join("\n");
    console.log(`  FAIL  ${label} (${secs}s)`);
    if (tail) console.log(tail.replace(/^/gm, "        "));
    failures.push(label);
    return { ok: false, out: raw };
  }
};

/**
 * Removes comments before matching, so a rule is not tripped by prose that describes the very
 * thing it forbids (e.g. the JSDoc in `module-app.ts` that quotes a raw Zod payload).
 * Naive but adequate: this only ever runs over our own source, not arbitrary input.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const walk = (dir, acc = []) => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
};

const normalize = (f) => relative(ROOT, f).split(sep).join("/");

console.log("\nGATE\n");

// 1–3: the compiler, the linter, the suite.
run("typecheck", "npx tsc --noEmit");
run("lint", "npx eslint . --quiet");
const tests = run("tests", "npx vitest run --reporter=dot");
if (tests.ok) {
  const match = /Tests\s+(\d+) passed/.exec(tests.out);
  if (match) console.log(`        ${match[1]} tests passing`);
}

// 4: structural invariants.
const allFiles = walk(join(ROOT, "src")).filter((f) => f.endsWith(".ts"));
for (const rule of RULES) {
  const hits = [];
  for (const file of allFiles) {
    const rel = normalize(file);
    if (rule.dir && !rel.startsWith(rule.dir)) continue;
    if (rule.filesOnly && !rule.filesOnly(rel)) continue;
    if (rule.allow(rel)) continue;
    const source = stripComments(readFileSync(file, "utf8"));
    const matches = source.match(rule.pattern);
    if (matches) hits.push(`${rel} (${matches.length})`);
  }
  if (hits.length) {
    console.log(`  FAIL  ${rule.name}`);
    for (const hit of hits) console.log(`        ${hit}`);
    failures.push(rule.name);
  } else {
    console.log(`  ok    ${rule.name}`);
  }
}

// 5: contracts are as wide as the code. Static, so it needs no DB and no running app.
run("contracts", "npx tsx scripts/check-contracts.ts");

// 6: optional — the document actually builds and every route appears in it.
if (OPENAPI) {
  const script = `import app from './src/index';
(async () => {
  const doc = await (await app.request('/openapi.json')).json();
  const paths = Object.keys(doc.paths ?? {});
  if (!paths.length) { console.error('openapi document has no paths'); process.exit(1); }
  console.log('openapi: ' + paths.length + ' paths generated');
})();`;
  const res = run("openapi", `npx tsx --env-file=.env -e "${script.replace(/"/g, '\\"')}"`);
  if (res.ok && res.out.trim()) console.log(`        ${res.out.trim().split("\n").pop()}`);
}

console.log("");
if (failures.length) {
  console.log(`GATE FAILED — ${failures.length} check(s): ${failures.join(", ")}\n`);
  process.exit(1);
}
console.log("GATE PASSED\n");
