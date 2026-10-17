/**
 * Static integrity checks for the mobile app.
 *
 * WHY THIS FILE IS STATIC RATHER THAN BEHAVIOURAL
 *
 * This suite was written after the bundler caught a real syntax error in
 * `src/shared/container.js` that 41 passing tests missed. The reason they missed it is
 * instructive: the container transitively imports `react-native` (via config.js -> Platform),
 * so it CANNOT be loaded in plain node at all. Every behavioural test in this project therefore
 * targets `src/domain` and `src/application`, which are platform-free by design.
 *
 * The container and the screens are verified two ways instead:
 *   1. here, by parsing and inspecting the source statically;
 *   2. by `npx expo export`, which is the real bundler and the authoritative check.
 *
 * That is a genuine limitation, stated here rather than papered over.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Babel ships with Expo, so this is the same parser the bundler will use. */
const babelParser = createRequire(import.meta.url)('@babel/parser');

function sourceFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !full.includes(`${path.sep}test${path.sep}`)) out.push(full);
  }
  return out;
}

const files = sourceFiles();
const rel = (f) => path.relative(ROOT, f);

/** Strip comments and string bodies so prose cannot trip a source assertion. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/* ================================================================== *
 * 1. Parse — with the same parser the bundler uses
 * ================================================================== */

test('every application source file parses as ESM + JSX', () => {
  assert.ok(files.length >= 10, `expected the app sources, found ${files.length}`);
  const failures = [];

  for (const file of files) {
    try {
      babelParser.parse(fs.readFileSync(file, 'utf8'), {
        sourceType: 'module',
        plugins: ['jsx'],
      });
    } catch (e) {
      failures.push(`${rel(file)}: ${e.message}`);
    }
  }

  assert.deepEqual(failures, [], `files that do not parse:\n${failures.join('\n')}`);
});

/* ================================================================== *
 * 2. Imports resolve and are installed
 * ================================================================== */

test('every relative import resolves to a real file', () => {
  const broken = [];
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
      if (!fs.existsSync(path.resolve(path.dirname(file), m[1]))) {
        broken.push(`${rel(file)} -> ${m[1]}`);
      }
    }
  }
  assert.deepEqual(broken, [], `unresolved imports:\n${broken.join('\n')}`);
});

test('every bare import names an installed package', () => {
  const missing = new Set();
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(
      /from '([^.'][^']*)'|\bimport\('([^.'][^']*)'\)/g
    )) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('node:')) continue; // built-in, not a package
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!fs.existsSync(path.join(ROOT, 'node_modules', pkg))) {
        missing.add(`${pkg}  (in ${rel(file)})`);
      }
    }
  }
  assert.deepEqual([...missing], [], `imports an uninstalled package:\n${[...missing].join('\n')}`);
});

test('every plugin in app.json is installed', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const plugins = app?.expo?.plugins ?? [];
  const missing = plugins.filter((p) => {
    const pkg = p.startsWith('@') || p.includes('/') ? p : p.split('[')[0];
    return !fs.existsSync(path.join(ROOT, 'node_modules', pkg));
  });
  assert.deepEqual(missing, [], `app.json references uninstalled plugin(s): ${missing.join(', ')}`);
});

test('package.json declares everything the sources import', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const runtime = new Set(['react', 'react-native']);

  const undeclared = new Set();
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(
      /from '([^.'][^']*)'|\bimport\('([^.'][^']*)'\)/g
    )) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('node:')) continue;
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (runtime.has(name) || declared.has(name)) continue;
      undeclared.add(`${name}  (imported by ${rel(file)})`);
    }
  }
  assert.deepEqual([...undeclared], [], `imported but not in package.json:\n${[...undeclared].join('\n')}`);
});

/* ================================================================== *
 * 3. Container wiring — checked in the source, since it cannot be imported here
 * ================================================================== */

test('the container wires every use case', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/container.js'), 'utf8');
  for (const key of [
    'api', 'fileSystem', 'importWorkbooks', 'loadDashboard',
    'runAnalysis', 'loadInsights', 'updateInsightStatus', 'loadPlanCritiques', 'saveDailyEntry',
  ]) {
    assert.match(src, new RegExp(`\\b${key}\\s*[=:]`), `container.${key} is not wired`);
  }
  assert.match(src, /export\s+const\s+container/);
  assert.match(src, /export\s+default\s+container/);
});

test('the API client exposes every endpoint the screens call', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/apiClient.js'), 'utf8');
  for (const fn of [
    'health', 'getConfig', 'getMonths', 'getMonth', 'getDays', 'getMetrics', 'getPrecheck',
    'analyse', 'getInsights', 'setInsightStatus', 'getPlanCritiques', 'getQuarantine',
    'resolveQuarantine', 'saveDailyEntry', 'uploadWorkbooks', 'scanFolder', 'preflightFolder',
    'getSheetsStatus', 'connectSheets', 'syncSheets',
  ]) {
    assert.match(src, new RegExp(`\\b${fn}\\s*:`), `apiClient.${fn} is missing`);
  }
});

test('endpoints used by the client are all defined in config', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'src/infrastructure/config.js'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'src/infrastructure/apiClient.js'), 'utf8');
  const used = new Set([...client.matchAll(/endpoints\.(\w+)/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !new RegExp(`\\b${k}\\s*:`).test(cfg));
  assert.deepEqual(missing, [], `endpoints used but undefined in config: ${missing.join(', ')}`);
});

/* ================================================================== *
 * 4. Screens are registered
 * ================================================================== */

test('the navigator exposes only the two daily screens', () => {
  const app = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
  const plan = fs.readFileSync(path.join(ROOT, 'src/interface/SimplePlanScreen.js'), 'utf8');
  const reflection = fs.readFileSync(path.join(ROOT, 'src/interface/SimpleReflectionScreen.js'), 'utf8');

  assert.match(plan, /function SimplePlanScreen/);
  assert.match(reflection, /function SimpleReflectionScreen/);
  assert.match(app, /name="DailyPlan"/);
  assert.match(app, /name="Reflection"/);
  assert.match(app, /component=\{SimplePlanScreen\}/);
  assert.match(app, /component=\{SimpleReflectionScreen\}/);

  for (const removedRoute of ['Dashboard', 'Focus', 'Insights', 'Import', 'Settings', 'PlanCritique', 'ReflectionQuality', 'FocusSession']) {
    assert.doesNotMatch(app, new RegExp(`name="${removedRoute}"`), `${removedRoute} should not be a daily screen`);
  }
});

test('progress accessibility values are integer percentages for native bridges', () => {
  const components = fs.readFileSync(path.join(ROOT, 'src/interface/components.js'), 'utf8');
  assert.match(components, /const accessiblePercentage = Math\.round\(percentage \* 100\)/);
  assert.match(components, /accessibilityValue=\{\{ min: 0, max: 100, now: accessiblePercentage \}\}/);
});

/* ================================================================== *
 * 6. Metro constraints
 * ================================================================== */

/**
 * Top-level await is not supported by Metro/Hermes.
 *
 * A module-scope `await import(...)` in `src/infrastructure/fileSystem.js` built fine under
 * `node --test` and only failed at `npx expo export` with `Unexpected token: name (_r)`. Any
 * future reintroduction would be caught here instead of at bundle time.
 */
test('no module uses top-level await', () => {
  const offenders = [];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');

    const ast = babelParser.parse(src, { sourceType: 'module', plugins: ['jsx', 'topLevelAwait'] });

    // Walk for an AwaitExpression whose nearest function ancestor is the Program.
    const walk = (node, insideFunction = false) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, insideFunction));

      const isFn =
        node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression' || node.type === 'ObjectMethod' ||
        node.type === 'ClassMethod';

      if (node.type === 'AwaitExpression' && !insideFunction) {
        offenders.push(`${rel(file)} — top-level await at line ${node.loc?.start?.line}`);
        return;
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'leadingComments') continue;
        walk(node[k], insideFunction || isFn);
      }
    };
    walk(ast.program, false);
  }

  assert.deepEqual(offenders, [], `top-level await is not bundleable by Metro:\n${offenders.join('\n')}`);
});

test('the optional native picker is resolved lazily, not at module scope', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'src/infrastructure/fileSystem.js'), 'utf8');
  const src = codeOnly(raw);
  assert.match(src, /async function ensurePicker/);
  assert.doesNotMatch(src, /documentsPicker\s*=\s*await/, 'must not await at module scope');
  assert.doesNotMatch(
    src,
    /listAllFiles|listDirectory/,
    'these do not exist in v10 of the library (the comment naming them is fine)'
  );
});

test('no source file imports an API the installed picker does not export', () => {
  const installed = path.join(ROOT, 'node_modules/@react-native-documents/picker');
  if (!fs.existsSync(installed)) return; // optional dependency

  const types = fs.readFileSync(path.join(installed, 'lib/typescript/index.d.ts'), 'utf8');
  const exported = new Set([...types.matchAll(/export \{ ([^}]+) \}/g)].flatMap((m) =>
    m[1].split(',').map((s) => s.trim().replace(/\s+as\s+.*/, '')).filter(Boolean)
  ));

  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/fileSystem.js'), 'utf8');
  const used = [...src.matchAll(/picker\??\.(\w+)/g)].map((m) => m[1]);
  const unknown = [...new Set(used)].filter((fn) => !exported.has(fn));

  assert.deepEqual(unknown, [], `uses picker APIs that do not exist: ${unknown.join(', ')}`);
});

/* ================================================================== *
 * 7. Secret hygiene
 * ================================================================== */

test('no source file contains anything that looks like a live credential', () => {
  const CHECKS = [
    /sk-or-v1-[A-Za-z0-9_-]{16,}/,
    /-----BEGIN (RSA )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9]{32,}/,
  ];
  const hits = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    CHECKS.forEach((re, i) => {
      re.lastIndex = 0;
      if (re.test(src)) hits.push(`${rel(file)} matches rule ${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `possible credentials committed:\n${hits.join('\n')}`);
});
