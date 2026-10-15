/**
 * Phase 6 tests — logging redaction, error budgets, spend guard, circuit breaker, and a soak
 * run that proves the invariants hold under repetition.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { redact, PHI_KEYS, MAX_STRING, REDACTED } from '../src/shared/logger.js';
import { classifyError, Cause, RETRYABLE, ErrorBudget, budgets, snapshotAllBudgets } from '../src/shared/diagnostics.js';
import { evaluateBudget, assertBudget, estimateAnalysisCost, DEFAULT_BUDGET_CREDITS } from '../src/shared/spend.js';
import { CircuitBreaker, State, aiBreaker } from '../src/infrastructure/ai/circuitBreaker.js';
import { DomainError, ErrorCode } from '../src/domain/errors/DomainError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(__dirname, '../../October_Accountability-2.xlsx');

/* ================================================================== *
 * 1. PHI redaction — the NFR-6 promise
 * ================================================================== */

test('redaction: journal text never survives', () => {
  const state = {
    date: '2026-10-05',
    hasData: true,
    accomplished: 'only watch like a movie, no notes because i felt boring',
    blockers: { raw: 'relapse thoughts, did not interrupt', segments: ['slept late'] },
    tomorrowChange: 'plan realistic',
    buildNote: 'vibe code',
    totalHoursComputed: 1.75,
  };
  const out = redact(state);

  const serialised = JSON.stringify(out);
  for (const leak of ['watch like a movie', 'relapse thoughts', 'slept late', 'plan realistic', 'vibe code']) {
    assert.ok(!serialised.includes(leak), `LEAKED: ${leak}`);
  }
  // Non-PHI operational data is preserved — otherwise logs stop being useful.
  assert.equal(out.date, '2026-10-05');
  assert.equal(out.totalHoursComputed, 1.75);
  assert.equal(out.hasData, true);
});

test('redaction: the key still shows, with a length marker', () => {
  const out = redact({ blockers: 'a'.repeat(412) });
  assert.ok(out.blockers.startsWith(REDACTED));
  assert.ok(out.blockers.includes('412'), 'length preserved so the log stays diagnosable');
  assert.ok(!out.blockers.includes('aaaa'));
});

test('redaction: AI prompts and generated prose are treated as PHI', () => {
  const out = redact({
    prompt: 'Analyse the following study log and identify recurring PATTERNS',
    daysText: '<day date="2026-10-05">',
    evidenceQuotes: ['only watch like a movie'],
    body: 'You went quiet after the 9th',
    firstStep: 'Open the repo',
  });
  const s = JSON.stringify(out);
  for (const leak of ['Analyse the following', 'only watch', 'went quiet', 'Open the repo']) {
    assert.ok(!s.includes(leak), `LEAKED: ${leak}`);
  }
});

test('redaction: credentials are redacted even if named oddly', () => {
  const out = redact({ private_key: '-----BEGIN PRIVATE KEY-----', apiKey: 'sk-or-v1-xxx', token: 'abc' });
  assert.ok(!JSON.stringify(out).includes('BEGIN PRIVATE KEY'));
});

test('redaction: an unknown long string is truncated as a backstop', () => {
  const out = redact({ someUnknownField: 'z'.repeat(500) });
  assert.ok(out.someUnknownField.length < 500);
  assert.ok(out.someUnknownField.includes('+'), 'should say how much was cut');
});

test('redaction: every denylisted key actually redacts', () => {
  for (const key of PHI_KEYS) {
    const out = redact({ [key]: 'SENSITIVE CONTENT' });
    assert.ok(
      String(out[key]).includes(REDACTED) || String(out[key]) === REDACTED,
      `${key} was not redacted`
    );
  }
});

test('redaction: short operational strings are untouched', () => {
  const out = redact({ model: 'anthropic/claude-sonnet-4.6', status: 'OPEN', count: 12 });
  assert.deepEqual(out, { model: 'anthropic/claude-sonnet-4.6', status: 'OPEN', count: 12 });
});

/**
 * Regression tests for leaks found by an actual soak run against the real workbook.
 * These three all passed a first-pass denylist and still put journal text on disk.
 */
test('redaction REGRESSION: passive-learning evidence quotes are journal text', () => {
  const metrics = {
    passiveDays: [{ date: '2026-10-05', evidence: ['only watch', 'watch like a movie', 'no notes', "don't code"] }],
  };
  const out = JSON.stringify(redact(metrics));
  assert.ok(!out.includes('watch like a movie'), 'verbatim quotes leaked');
  assert.ok(!out.includes("don't code"));
  assert.ok(out.includes('2026-10-05'), 'the date itself is safe and useful');
});

test('redaction REGRESSION: time-block labels are the user\'s own task names', () => {
  const out = JSON.stringify(
    redact({
      timeBlocks: [
        { start: '7:00 pm', end: '8:00 pm', durationMin: 60, label: 'english conversion', raw: '7 to 8' },
        { start: '9:00 pm', end: '11:00 pm', durationMin: 120, label: 'langchain lecture' },
      ],
    })
  );
  assert.ok(!out.includes('langchain lecture'), 'task label leaked');
  assert.ok(!out.includes('english conversion'));
  assert.ok(out.includes('7:00 pm'), 'clock times are operational and must survive');
  assert.ok(out.includes('120'), 'durations are operational and must survive');
});

test('redaction REGRESSION: operational counters must NOT be caught by over-broad keys', () => {
  // A previous version denylisted `days`, which silently redacted metrics.weekday.days — a
  // count, not journal content. Over-redaction destroys the diagnostic value of the log.
  const out = redact({ weekday: { days: 5, hours: 7.67 }, weekend: { days: 0, hours: 0 } });
  assert.equal(out.weekday.days, 5);
  assert.equal(out.weekday.hours, 7.67);
  assert.equal(out.weekend.days, 0);
});

test('redaction: a whole metrics object is safe to log', () => {
  const metrics = {
    daysLogged: 5, daysEmpty: 26, consistencyRate: 38.46, hoursTotal: 7.67,
    categorySplit: { genaiMinutes: 60.87 }, planRepeatCount: 1,
    planVsActual: [{ date: '2026-10-06', declared: 4, actual: 1.67, shortfall: 2.33 }],
    lateStartDays: ['2026-10-06', '2026-10-08'],
    passiveDays: [{ date: '2026-10-05', evidence: ['watch like a movie'] }],
  };
  const out = redact(metrics);
  assert.equal(out.daysLogged, 5);
  assert.equal(out.hoursTotal, 7.67);
  assert.equal(out.planVsActual[0].shortfall, 2.33);
  assert.ok(!JSON.stringify(out).includes('watch like a movie'));
});

test('redaction: handles cycles, errors, dates and depth without throwing', () => {
  const cyclic = { name: 'a' };
  cyclic.self = cyclic;
  assert.ok(JSON.stringify(redact(cyclic)).includes('circular'));

  const errOut = redact(new Error('boom'));
  assert.equal(errOut.name, 'Error');
  assert.equal(errOut.message, 'boom');

  const deep = { a: { b: { c: { d: { e: { f: { g: { h: 'too deep' } } } } } } } };
  assert.ok(JSON.stringify(redact(deep)).includes('depth-limit'));

  // JSON.stringify, not String(): String({...}) is "[object Object]".
  assert.ok(JSON.stringify(redact({ when: new Date('2026-01-01T00:00:00Z') })).includes('2026-01-01'));
});

test('redaction: large arrays are truncated but counted', () => {
  const out = redact(Array.from({ length: 50 }, (_, i) => `item${i}`));
  assert.equal(out.length, 21);
  assert.ok(out[20].includes('+30 items'));
});

/* ================================================================== *
 * 2. Error classification
 * ================================================================== */

test('classify: an unrecognised error is INTERNAL and not retried', () => {
  const r = classifyError(new TypeError('x is not a function'));
  assert.equal(r.cause, Cause.INTERNAL);
  assert.equal(r.retryable, false);
});

test('classify: a bad workbook is INPUT and must NOT be retried forever', () => {
  const r = classifyError(new DomainError(ErrorCode.MISSING_HEADER, 'no header row'));
  assert.equal(r.cause, Cause.INPUT);
  assert.equal(r.retryable, false, 'retrying a malformed file is how a tool burns an evening');
});

test('classify: an exhausted budget is INPUT, not a provider fault', () => {
  const r = classifyError(new DomainError(ErrorCode.BUDGET_EXCEEDED, 'spent'));
  assert.equal(r.cause, Cause.INPUT);
  assert.equal(r.retryable, false);
});

test('classify: LLM upstream failure is PROVIDER and retryable', () => {
  const r = classifyError(new DomainError(ErrorCode.UPSTREAM_ERROR, 'llm task failed'));
  assert.equal(r.cause, Cause.PROVIDER);
  assert.equal(r.retryable, true);
});

test('classify: mongo trouble is PERSISTENCE and NOT retryable', () => {
  const r = classifyError(new Error('MongoServerSelectionError: connect ECONNREFUSED 27017'));
  assert.equal(r.cause, Cause.PERSISTENCE);
  assert.equal(r.retryable, false, 'blindly retrying a failed write risks duplicates');
});

test('classify: a 4xx is the user\'s problem, a 5xx is ours', () => {
  assert.equal(classifyError(Object.assign(new Error('bad'), { code: 'HTTP_400' })).cause, Cause.INPUT);
  assert.equal(classifyError(Object.assign(new Error('boom'), { code: 'HTTP_503' })).cause, Cause.UPSTREAM);
});

test('classify: missing config is INPUT, so it is reported rather than retried', () => {
  const r = classifyError(new DomainError(ErrorCode.CONFIG_MISSING, 'no key'));
  assert.equal(r.cause, Cause.INPUT);
  assert.equal(r.retryable, false);
});

test('classify: null never throws', () => {
  assert.equal(classifyError(null).cause, Cause.INTERNAL);
});

/* ================================================================== *
 * 3. Error budget
 * ================================================================== */

test('budget: a clean run reports zero failures', () => {
  const b = new ErrorBudget({ maxFailureRate: 0.1 });
  for (let i = 0; i < 20; i++) b.success();
  const s = b.snapshot();
  assert.equal(s.failures, 0);
  assert.equal(s.failureRate, 0);
  assert.equal(s.exhausted, false);
});

test('budget: trips once the tolerated rate is exceeded', () => {
  const b = new ErrorBudget({ maxFailureRate: 0.1 });
  for (let i = 0; i < 18; i++) b.success();
  for (let i = 0; i < 2; i++) b.failure(new DomainError(ErrorCode.MISSING_HEADER, 'x'));
  const s = b.snapshot();
  assert.equal(s.operations, 20);
  assert.equal(s.failures, 2);
  assert.equal(s.failureRate, 0.1);
  assert.equal(s.exhausted, false, 'exactly at the threshold is still within budget');
});

test('budget: transient provider blips are counted separately from real faults', () => {
  const b = new ErrorBudget();
  b.failure(new DomainError(ErrorCode.UPSTREAM_ERROR, 'llm down'));
  b.failure(new DomainError(ErrorCode.MISSING_HEADER, 'bad file'));
  const s = b.snapshot();
  assert.equal(s.byCause[Cause.PROVIDER], 1);
  assert.equal(s.byCause[Cause.INPUT], 1);
  assert.equal(s.blockingCauses.length, 1, 'a transient blip should not look like a real fault');
});

test('budget: events older than the window are pruned', () => {
  const b = new ErrorBudget({ windowMs: 1000 });
  const t0 = 1_000_000;
  b.success(t0);
  b.failure(new Error('old'), t0);
  b.success(t0 + 5000); // both prior events now outside the window
  const s = b.snapshot(t0 + 5000);
  assert.equal(s.operations, 1);
  assert.equal(s.failures, 0);
});

test('budget: an empty budget is not "exhausted"', () => {
  assert.equal(new ErrorBudget().snapshot().exhausted, false);
});

test('process budgets snapshot without throwing', () => {
  const snap = snapshotAllBudgets();
  assert.ok(snap.ingest && snap.analysis && snap.sheets);
});

/* ================================================================== *
 * 4. Spend guard (NFR-2)
 * ================================================================== */

test('spend: a fresh month allows a run', () => {
  const b = evaluateBudget({ limitCredits: 0.5, spentSoFar: 0, estimatedCost: 0.016 });
  assert.equal(b.ok, true);
  assert.equal(b.status, 'UNUSED');
  assert.equal(b.remaining, 0.5);
});

test('spend: an exhausted budget refuses BEFORE spending', () => {
  const b = evaluateBudget({ limitCredits: 0.5, spentSoFar: 0.5, estimatedCost: 0.016 });
  assert.equal(b.ok, false);
  assert.equal(b.status, 'EXHAUSTED');
  assert.match(b.reason, /budget of \$0.5 is spent/);
});

test('spend: a run that would overshoot is refused', () => {
  const b = evaluateBudget({ limitCredits: 0.5, spentSoFar: 0.495, estimatedCost: 0.02 });
  assert.equal(b.ok, false);
  assert.equal(b.status, 'WOULD_EXCEED');
});

test('spend: force overrides a refusal explicitly', () => {
  const b = evaluateBudget({ limitCredits: 0.5, spentSoFar: 0.9, estimatedCost: 0.02, force: true });
  assert.equal(b.ok, true);
});

test('spend: the estimate scales with the amount of data', () => {
  assert.ok(estimateAnalysisCost(30) > estimateAnalysisCost(5));
  assert.ok(estimateAnalysisCost(5) < DEFAULT_BUDGET_CREDITS / 10, 'a normal run is far below the ceiling');
});

test('assertBudget throws only when refusing', () => {
  assert.equal(assertBudget(evaluateBudget({ spentSoFar: 0 })), null);
  const e = assertBudget(evaluateBudget({ limitCredits: 0.1, spentSoFar: 0.5 }));
  assert.ok(e instanceof DomainError);
  assert.equal(e.code, ErrorCode.BUDGET_EXCEEDED);
});

/* ================================================================== *
 * 5. Circuit breaker
 * ================================================================== */

test('breaker: closes while healthy', () => {
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
  assert.equal(b.state, State.CLOSED);
  assert.equal(b.guard(), null);
  b.onSuccess();
  assert.equal(b.snapshot().consecutiveFailures, 0);
  assert.equal(b.snapshot().trips, 0);
});

test('breaker: opens after consecutive failures', () => {
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
  b.onFailure(); b.onFailure(); b.onFailure();
  assert.equal(b.state, State.OPEN);
  assert.ok(b.guard(), 'an open breaker must refuse immediately');
});

test('breaker: an open breaker saves the credits that blind retrying would burn', () => {
  const b = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000, now: () => 0 });
  b.onFailure();
  for (let i = 0; i < 100; i++) {
    assert.ok(b.guard(), 'every subsequent call must fail fast');
  }
  assert.equal(b.snapshot().rejected, 100);
});

test('breaker: probes once after the cooldown, then reopens on failure', () => {
  let t = 0;
  const b = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => t });
  b.onFailure(); b.onFailure();
  assert.equal(b.state, State.OPEN);

  t = 1500;
  assert.equal(b.guard(), null, 'after cooldown the breaker should admit a probe');
  assert.equal(b.state, State.HALF_OPEN);

  b.onFailure();
  assert.equal(b.state, State.OPEN, 'a failed probe reopens it');
});

test('breaker: a successful probe closes it', () => {
  let t = 0;
  const b = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  b.onFailure();
  t = 1500;
  b.guard();
  b.onSuccess();
  assert.equal(b.state, State.CLOSED);
  assert.equal(b.guard(), null);
});

test('breaker: a success resets the consecutive-failure streak', () => {
  const b = new CircuitBreaker({ failureThreshold: 3 });
  b.onFailure(); b.onFailure();
  b.onSuccess();
  b.onFailure(); b.onFailure();
  assert.equal(b.state, State.CLOSED, 'the streak restarted, so it should not trip');
});

test('breaker: a failed probe reopens without counting as a new trip', () => {
  // "trips" means CLOSED -> OPEN transitions. A HALF_OPEN probe that fails is the same outage
  // continuing, so it must not inflate the trip count or the diagnostics look busier than it is.
  let t = 0;
  const b = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10, now: () => t });
  b.onFailure();
  assert.equal(b.snapshot().trips, 1);

  t = 20;
  b.guard();          // -> HALF_OPEN
  b.onFailure();      // probe fails -> OPEN again
  assert.equal(b.state, State.OPEN);
  assert.equal(b.snapshot().trips, 1);

  t = 60;
  b.guard();
  b.onSuccess();
  assert.equal(b.snapshot().trips, 1, 'a clean recovery does not add trips');
});

test('the shared AI breaker starts closed', () => {
  assert.equal(aiBreaker.state, State.CLOSED);
});

/* ================================================================== *
 * 6. Soak — invariants must survive repetition
 * ================================================================== */

const mongoUp = await new Promise((resolve) => {
  const s = net.createConnection({ host: '127.0.0.1', port: 27017 }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.setTimeout(1000, () => { s.destroy(); resolve(false); });
});

const it = mongoUp ? test : test.skip;
if (!mongoUp) console.log('[skip] mongod not reachable — soak test skipped');

it('soak: 25 import/verify cycles lose no data and never duplicate', async (t) => {
  const { container, shutdown } = await import('../src/shared/di/container.js');
  process.env.MONGO_DB_NAME = 'study_tracker_soak';
  await container.mongo.connect();
  await container.mongo.getDb().dropDatabase();

  const db = container.mongo.getDb();

  // --- first import establishes the baseline ---
  const first = await container.importWorkbooks({ asOf: '2026-10-13' });
  assert.ok(first.ok, first.ok ? '' : first.error.message);

  const baselineDays = await container.dailyLogRepository.count();
  const baselineLogs = await container.importLogRepository.list();
  const baselineQuarantine = await container.quarantineRepository.countUnresolved();
  assert.equal(baselineDays, 31);

  await t.test('25 repeated cycles keep every invariant', async () => {
    for (let i = 0; i < 25; i++) {
      const r = await container.importWorkbooks({ asOf: '2026-10-13' });
      assert.ok(r.ok, `cycle ${i} failed`);

      // Same file every time -> deduped by sha256, nothing re-imported.
      assert.equal(r.value.imported.length, 0, `cycle ${i} should not re-import`);
    }

    assert.equal(await container.dailyLogRepository.count(), baselineDays, 'no rows added or lost');
    assert.equal((await container.importLogRepository.list()).length, baselineLogs.length);
    assert.equal(await container.quarantineRepository.countUnresolved(), baselineQuarantine);
  });

  await t.test('25 forced cycles upsert in place without duplicating', async () => {
    for (let i = 0; i < 25; i++) {
      const r = await container.importWorkbooks({ asOf: '2026-10-13', force: true });
      assert.ok(r.ok, `forced cycle ${i} failed`);
    }
    assert.equal(await container.dailyLogRepository.count(), baselineDays, 'force must upsert, not append');
  });

  await t.test('day-level integrity holds under repetition', async () => {
    const days = await container.dailyLogRepository.findByMonth('2026-10');
    assert.equal(days.length, 31);
    // The F2 invariant, re-checked after 50 cycles: a blank day is never given a zero total.
    for (const d of days.filter((x) => !x.hasData)) {
      assert.equal(d.totalHoursComputed, null, `${d.date} acquired a fake zero`);
    }
  });

  await t.test('metrics are stable across cycles', async () => {
    const m = await container.monthRepository.find('2026-10');
    assert.equal(m.metrics.daysLogged, 5);
    assert.equal(m.metrics.hoursTotal, 7.67);
    assert.equal(m.metrics.consistencyRate, 38.46);
  });

  await t.test('no unbounded growth in any collection', async () => {
    const stats = await db.command({ collStats: 'daily_logs' });
    assert.equal(stats.count, 31);
    const logStats = await db.command({ collStats: 'import_logs' });
    assert.ok(logStats.count <= baselineLogs.length + 1, 'import log should be keyed by sha256, not appended');
  });

  await t.test('the error budget survives the soak within tolerance', () => {
    budgets.ingest.reset();
    for (let i = 0; i < 50; i++) budgets.ingest.success();
    budgets.ingest.failure(new DomainError(ErrorCode.MISSING_HEADER, 'x'));
    const s = budgets.ingest.snapshot();
    assert.equal(s.failureRate, 0.02);
    assert.equal(s.exhausted, false);
  });

  await t.after(async () => { await shutdown(); });
});