import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReflectionCoachFallback } from '../src/domain/services/ReflectionCoach.js';

test('reflection coach fallback returns exactly three grounded signals', () => {
  const result = buildReflectionCoachFallback({
    accomplished: 'Completed three confidence interval examples',
    buildNote: 'Wrote the worked-example summary',
    blockers: { raw: 'Started late after checking my phone' },
    tomorrowChange: 'Put the phone away before opening the notes',
  });

  assert.deepEqual(Object.keys(result), ['observation', 'obstaclePattern', 'tomorrowSuggestion']);
  assert.match(result.observation, /confidence interval/);
  assert.match(result.obstaclePattern, /phone/);
  assert.match(result.tomorrowSuggestion, /phone away/);
});

test('reflection coach fallback stays useful when the reflection is blank', () => {
  const result = buildReflectionCoachFallback({});

  assert.equal(result.observation, 'No clear accomplishment was recorded today.');
  assert.equal(result.obstaclePattern, 'No clear obstacle pattern was recorded today.');
  assert.match(result.tomorrowSuggestion, /first action/);
});

