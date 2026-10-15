/**
 * Vercel's Express entry point.
 *
 * The local process entry remains src/interface/http/server.js, where app.listen() is
 * guarded behind an executable-file check. Vercel imports this module and serves the
 * exported Express application as a function, so importing it must never open a port.
 */

import { createApp } from './interface/http/server.js';

const app = createApp();

export default app;
