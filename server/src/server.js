/**
 * Vercel's Express entry point.
 *
 * The local process entry remains src/interface/http/server.js, where app.listen() is
 * guarded behind an executable-file check. Vercel imports this module and serves the
 * exported Express application as a function, so importing it must never open a port.
 */

import express from 'express';
import { createApp } from './interface/http/server.js';

// Keep the Express import in this recognized Vercel entry point. Vercel's framework detector
// uses this file to identify the deployment as an Express function.
const app = createApp({ expressFactory: express });

export default app;
