#!/usr/bin/env node
/**
 * verify-no-secrets — fail if a credential reaches the mobile bundle.
 *
 * There is no CI here (single-user local project), so this runs as `npm run verify`. A React
 * Native JS bundle is trivially extractable: anything shipped in it is public. The OpenRouter
 * key and the Google service-account key must therefore never appear under mobile/.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SKIP = new Set(['node_modules', '.expo', '.git', 'ios', 'android']);

/** Each entry: label, regex, and where a legitimate occurrence could hide. */
const CHECKS = [
  { name: 'OpenRouter key', pattern: /sk-or-v1-[A-Za-z0-9_-]{16,}/g },
  { name: 'Google private key', pattern: /-----BEGIN (RSA )?PRIVATE KEY-----/g },
  { name: 'AWS access key id', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'Slack token', pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Generic sk- secret', pattern: /\bsk-[A-Za-z0-9]{32,}/g },
];

/** Files that legitimately NAME a secret without containing one. */
const ALLOWLIST = new Set(['.env.example', 'verify-no-secrets.js']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const findings = [];

for (const file of walk(ROOT)) {
  const base = path.basename(file);
  if (ALLOWLIST.has(base) || base === '.env') continue;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable
  }

  for (const check of CHECKS) {
    check.pattern.lastIndex = 0;
    let match;
    while ((match = check.pattern.exec(content)) !== null) {
      findings.push({
        file: path.relative(ROOT, file),
        check: check.name,
        // Enough to identify, not enough to use.
        preview: match[0].slice(0, 12) + '…' + match[0].slice(-4),
      });
    }
  }
}

if (findings.length === 0) {
  console.log('✓ no secrets found in mobile/');
  process.exit(0);
}

console.error(`✗ ${findings.length} potential secret(s) in mobile/\n`);
for (const f of findings) {
  console.error(`  ${f.file}\n    ${f.check}: ${f.preview}`);
}
console.error('\nA React Native bundle is readable by anyone with the app. Move these to server/.env.');
process.exit(1);