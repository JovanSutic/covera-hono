/**
 * Static contract check: does every route declare the error statuses its guards imply?
 *
 * Reads `src/modules/<m>/<m>.contract.ts` with the TypeScript parser (no execution, no DB) and
 * resolves each route's `responses` — including `...bundle` spreads — down to concrete statuses.
 * For each `createRoute({ ... })` it asserts:
 *
 *   - `authGuard` in `middleware`              → 401 present
 *   - `rolesGuard` / `apartmentGuard`          → 403 present
 *   - any route at all                         → 500 present
 *
 * Spreads are resolved by evaluating the local `const xErrors = errorResponses([...])` calls,
 * where each array element is either a string literal code or a spread of an imported bundle
 * (`AUTHED`, `ROLE`, …). Statuses come from the real `ERROR_REGISTRY`, not a hardcoded map.
 *
 * Unresolvable spreads are reported as problems rather than skipped: a check that silently
 * passes because it could not read the input is worse than no check.
 *
 * Usage: npx tsx scripts/check-contracts.ts   (exit 1 on any problem)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ERROR_REGISTRY } from "../src/core/errors/error.codes";
import {
  AUTHED,
  ROLE,
  VALIDATION,
  APARTMENT_SCOPED,
} from "../src/core/errors/error.responses";

const MODULES = "src/modules";

/** Imported code bundles the contracts spread. Extend if `error.responses.ts` grows one. */
const BUNDLES: Record<string, readonly string[]> = {
  AUTHED,
  ROLE,
  VALIDATION,
  APARTMENT_SCOPED,
};

type Codes = string[];

interface RouteInfo {
  file: string;
  name: string;
  guards: string[];
  codes: Codes;
  unresolved: string[];
}

/** Resolves an array-literal expression to the set of registry codes it names. */
const resolveCodes = (
  node: ts.Expression,
  localBundles: Map<string, Codes>,
  source: ts.SourceFile,
  unresolved: string[],
): Codes => {
  if (ts.isCallExpression(node)) {
    // `errorResponses([...])` / `baseResponses` — recurse into the first argument.
    if (node.arguments[0]) return resolveCodes(node.arguments[0], localBundles, source, unresolved);
    return [];
  }
  if (!ts.isArrayLiteralExpression(node)) {
    unresolved.push(node.getText(source));
    return [];
  }

  const codes: Codes = [];
  for (const element of node.elements) {
    if (ts.isStringLiteral(element)) {
      codes.push(element.text);
      continue;
    }
    if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
      const name = element.expression.text;
      const local = localBundles.get(name);
      if (local) codes.push(...local);
      else if (BUNDLES[name]) codes.push(...BUNDLES[name]!);
      else unresolved.push(`spread of '${name}'`);
      continue;
    }
    if (ts.isIdentifier(element)) {
      const local = localBundles.get(element.text);
      if (local) codes.push(...local);
      else if (BUNDLES[element.text]) codes.push(...BUNDLES[element.text]!);
      else unresolved.push(`reference to '${element.text}'`);
      continue;
    }
    unresolved.push(element.getText(source));
  }
  return codes;
};

const analyze = (file: string) => {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);

  // Pass 1 — every local `const x = errorResponses([...])` bundle in this file.
  const localBundles = new Map<string, Codes>();
  const collectBundles = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = ts.isIdentifier(node.initializer.expression)
        ? node.initializer.expression.text
        : "";
      if (callee === "errorResponses" || callee === "baseResponses") {
        localBundles.set(node.name.text, resolveCodes(node.initializer, localBundles, source, []));
      }
    }
    ts.forEachChild(node, collectBundles);
  };
  collectBundles(source);

  // Pass 2 — every `createRoute({...})`.
  const routes: RouteInfo[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "createRoute" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const parent = node.parent;
      const name =
        ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
          ? parent.name.text
          : "<anonymous>";

      const guards: string[] = [];
      const codes: Codes = [];
      const unresolved: string[] = [];

      for (const prop of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;

        if (prop.name.text === "middleware") {
          const text = prop.initializer.getText(source);
          for (const guard of ["authGuard", "rolesGuard", "apartmentGuard"]) {
            if (new RegExp(`\\b${guard}\\b`).test(text)) guards.push(guard);
          }
        }

        if (prop.name.text === "responses" && ts.isObjectLiteralExpression(prop.initializer)) {
          for (const entry of prop.initializer.properties) {
            if (ts.isPropertyAssignment(entry)) {
              const key = entry.name.getText(source);
              // Success statuses (`200`, `201`) are literal keys; error bundles are spreads.
              if (/^\d+$/.test(key)) codes.push(`__status_${key}`);
            } else if (ts.isSpreadAssignment(entry) && ts.isIdentifier(entry.expression)) {
              const local = localBundles.get(entry.expression.text);
              if (local) codes.push(...local);
              else unresolved.push(`responses spread '${entry.expression.text}'`);
            } else {
              unresolved.push(`responses entry '${entry.getText(source)}'`);
            }
          }
        }
      }

      routes.push({ file, name, guards, codes, unresolved });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return routes;
};

const contractFiles: string[] = [];
for (const module of readdirSync(MODULES)) {
  const file = join(MODULES, module, `${module}.contract.ts`);
  try {
    readFileSync(file);
    contractFiles.push(file);
  } catch {
    // Module has no contract; not this check's problem.
  }
}

const problems: string[] = [];
let checked = 0;

for (const file of contractFiles) {
  for (const route of analyze(file)) {
    checked++;
    const where = `${file.replace(/\\/g, "/")} → ${route.name}`;

    for (const gap of route.unresolved) problems.push(`${where}: cannot resolve ${gap}`);

    const statuses = new Set<number>();
    for (const code of route.codes) {
      if (code.startsWith("__status_")) {
        statuses.add(Number(code.slice("__status_".length)));
        continue;
      }
      const entry = (ERROR_REGISTRY as Record<string, { status: number } | undefined>)[code];
      if (!entry) {
        problems.push(`${where}: '${code}' is not in ERROR_REGISTRY`);
        continue;
      }
      statuses.add(entry.status);
    }

    if (!statuses.has(500)) problems.push(`${where}: missing 500`);
    if (route.guards.includes("authGuard") && !statuses.has(401))
      problems.push(`${where}: mounts authGuard but declares no 401`);
    if (
      (route.guards.includes("rolesGuard") || route.guards.includes("apartmentGuard")) &&
      !statuses.has(403)
    )
      problems.push(`${where}: mounts a role/apartment guard but declares no 403`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`contracts: ${checked} routes declare the statuses their guards imply`);
