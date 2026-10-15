/**
 * Validate the Express function that Vercel will deploy.
 *
 * This project has no frontend bundle or transpilation step. The build still performs a
 * meaningful deployment check: it imports the Vercel entry point and verifies that it
 * exports an Express-compatible request handler without starting a local listener.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const entryPath = path.join(projectRoot, 'src', 'server.js');

if (!fs.existsSync(entryPath)) {
  throw new Error(`[build] Vercel Express entry point is missing: ${entryPath}`);
}

const module = await import(pathToFileURL(entryPath).href);

if (typeof module.default !== 'function') {
  throw new Error('[build] src/server.js must default-export the Express application');
}

console.log(`[build] Vercel Express entry verified: ${path.relative(projectRoot, entryPath)}`);
