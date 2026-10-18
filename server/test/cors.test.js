import test from 'node:test';
import assert from 'node:assert/strict';
import { corsMiddleware } from '../src/interface/http/server.js';

const runCors = ({ origin, method = 'OPTIONS' }) => {
  const headers = new Map();
  let status = null;
  let continued = false;
  const response = {
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    sendStatus: (code) => { status = code; return response; },
  };
  corsMiddleware({ method, headers: { origin } }, response, () => { continued = true; });
  return { headers, status, continued };
};

test('allows Expo web at localhost:8081', () => {
  const response = runCors({ origin: 'http://localhost:8081' });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /PUT/);
});

test('does not grant CORS access to an unknown origin', () => {
  const response = runCors({ origin: 'http://malicious.example' });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), undefined);
});
