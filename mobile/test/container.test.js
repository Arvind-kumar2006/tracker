/** Static integrity checks for the intentionally small two-screen mobile app. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
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
const rel = (file) => path.relative(ROOT, file);

test('every mobile source file parses as ESM plus JSX', () => {
  const failures = [];
  for (const file of files) {
    try {
      babelParser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    } catch (error) {
      failures.push(`${rel(file)}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('every relative import resolves and every package is declared', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  const broken = [];
  const missing = new Set();

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from '([^']+)'|\bimport\('([^']+)'\)/g)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('.')) {
        if (!fs.existsSync(path.resolve(path.dirname(file), specifier))) broken.push(`${rel(file)} -> ${specifier}`);
        continue;
      }
      if (specifier.startsWith('node:')) continue;
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (!declared.has(packageName)) missing.add(`${packageName} in ${rel(file)}`);
    }
  }

  assert.deepEqual(broken, [], `unresolved imports: ${broken.join(', ')}`);
  assert.deepEqual([...missing], [], `undeclared packages: ${[...missing].join(', ')}`);
});

test('the container and API expose only daily plan/reflection operations', () => {
  const container = fs.readFileSync(path.join(ROOT, 'src/shared/container.js'), 'utf8');
  const api = fs.readFileSync(path.join(ROOT, 'src/infrastructure/apiClient.js'), 'utf8');
  for (const [containerKey, apiKey] of [['loadDay', 'getDay'], ['loadReflectionCoach', 'getReflectionCoach'], ['loadSheetsStatus', 'getSheetsStatus'], ['saveDailyPlan', 'saveDailyPlan'], ['saveDailyEntry', 'saveDailyEntry']]) {
    assert.match(container, new RegExp(`\\b${containerKey}\\s*:`));
    assert.match(api, new RegExp(`\\b${apiKey}\\s*:`));
  }
  for (const removed of ['fileSystem', 'loadDashboard', 'runAnalysis', 'getReflectionQuality', 'saveFocusSession']) {
    assert.doesNotMatch(container, new RegExp(`\\b${removed}\\b`));
  }
});

test('the navigator exposes exactly the two daily screens', () => {
  const app = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
  assert.match(app, /component=\{SimplePlanScreen\}/);
  assert.match(app, /component=\{SimpleReflectionScreen\}/);
  assert.match(app, /name="Settings" component=\{SettingsScreen\}/);
  assert.equal((app.match(/<Tabs\.Screen/g) ?? []).length, 2);
  assert.doesNotMatch(app, /Dashboard|Focus|Insights|Import|PlanCritique|ReflectionQuality/);
});

test('legacy mobile screens and generated web output are gone', () => {
  for (const file of [
    'src/interface/screens.js',
    'src/interface/DailyPlanScreen.js',
    'src/interface/FocusSessionScreen.js',
    'src/interface/PlanCritiqueScreen.js',
    'src/interface/ReflectionScreen.js',
    'src/interface/ReflectionQualityScreen.js',
    'src/application/useCases.js',
    'src/infrastructure/fileSystem.js',
    'dist/index.html',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false, `${file} should be removed`);
  }
});

test('no mobile source contains a live credential', () => {
  const checks = [
    /sk-or-v1-[A-Za-z0-9_-]{16,}/,
    /-----BEGIN (RSA )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9]{32,}/,
  ];
  const hits = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    checks.forEach((check, index) => {
      if (check.test(source)) hits.push(`${rel(file)} rule ${index + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
