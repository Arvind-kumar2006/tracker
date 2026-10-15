#!/usr/bin/env node

/**
 * Fail if credentials are present in files that can be bundled or committed.
 * Runtime secrets belong in server/.env, which is ignored and intentionally skipped.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SKIP = new Set(['node_modules', '.git', 'coverage']);
const ALLOWLIST = new Set(['.env', '.env.example', 'verify-no-secrets.js']);
const CHECKS = [
  { name: 'OpenRouter key', pattern: /sk-or-v1-[A-Za-z0-9_-]{16,}/g },
  {
    name: 'Google private key',
    pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]{40,}?-----END (?:RSA )?PRIVATE KEY-----/g,
  },
  { name: 'AWS access key id', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'Slack token', pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Generic sk secret', pattern: /\bsk-[A-Za-z0-9]{32,}/g },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const findings = [];
for (const file of walk(ROOT)) {
  if (ALLOWLIST.has(path.basename(file))) continue;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const check of CHECKS) {
    check.pattern.lastIndex = 0;
    let match;
    while ((match = check.pattern.exec(content)) !== null) {
      findings.push({
        file: path.relative(ROOT, file),
        check: check.name,
        preview: `${match[0].slice(0, 12)}…${match[0].slice(-4)}`,
      });
    }
  }
}

if (findings.length === 0) {
  console.log('✓ no secrets found in server/');
  process.exit(0);
}

console.error(`✗ ${findings.length} potential secret(s) in server/`);
for (const finding of findings) {
  console.error(`  ${finding.file}\n    ${finding.check}: ${finding.preview}`);
}
console.error('\nMove runtime credentials to server/.env. Never commit or bundle them.');
process.exit(1);
