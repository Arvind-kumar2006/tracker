/**
 * MetricsCalculator tests, written against the real October workbook.
 * These are pure functions — no mongo, no network, no LLM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkbook } from '../src/infrastructure/persistence/xlsx/xlsxReader.js';
import { normalizeWorkbook } from '../src/domain/services/WorkbookNormalizer.js';
import {
  calculateMetrics,
  detectPassiveLearning,
  linearSlope,
  LATE_START_THRESHOLD_MIN,
} from '../src/domain/services/MetricsCalculator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(__dirname, '../../October_Accountability-2.xlsx');

const wb = await readWorkbook(WORKBOOK);
const { entries } = normalizeWorkbook({ rows: wb.sheets[0].rows, fileName: wb.fileName });
const m = calculateMetrics({ entries, month: '2026-10', asOf: '2026-10-13' });

test('counts logged days separately from elapsed days', () => {
  assert.equal(m.daysLogged, 5);
  assert.equal(m.daysElapsed, 13);
  assert.equal(m.daysEmpty, 26);
  assert.equal(m.consistencyRate, 38.46);
});

test('an empty day never contributes a zero to the averages', () => {
  // 4 days have hours; the 5th logged day (Oct 9) has a plan but no time recorded.
  assert.equal(m.daysWithHours, 4);
  assert.equal(m.hoursTotal, 7.67);
  assert.equal(m.hoursAvgPerLoggedDay, 1.53);
});

test('category split sums to ~100%', () => {
  const total = Object.values(m.categorySplit).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100) < 0.1, `expected ~100, got ${total}`);
  assert.equal(m.categorySplit.genaiMinutes, 60.87);
  assert.equal(m.categorySplit.englishMinutes, 0);
});

test('partial is not counted as a met target', () => {
  assert.equal(m.daysTargetMet, 0);
  assert.equal(m.daysPartial, 2);
  assert.equal(m.daysMissed, 2);
});

test('passive learning is detected with the exact quotes that triggered it', () => {
  assert.equal(m.passiveLearningRatio, 20);
  assert.equal(m.passiveDays.length, 1);
  assert.equal(m.passiveDays[0].date, '2026-10-05');
  const ev = m.passiveDays[0].evidence;
  assert.ok(ev.includes('only watch'));
  assert.ok(ev.includes('no notes'));
  assert.ok(ev.includes("don't code"));
});

test('passive learning does not fire on ordinary reflections', () => {
  assert.equal(
    detectPassiveLearning({ accomplished: 'did the image captioning part of OJT', buildNote: '' }).passive,
    false
  );
  assert.equal(detectPassiveLearning({ accomplished: '', buildNote: '' }).passive, false);
});

test('plan vs actual exposes the under-scoping gap', () => {
  assert.equal(m.planVsActual.length, 2);
  for (const p of m.planVsActual) {
    assert.equal(p.declared, 4);
    assert.ok(p.actual < p.declared, `${p.date} should show a shortfall`);
  }
  assert.equal(m.planVsActual[0].shortfall, 2.33);
});

test('late start uses the EARLIEST block of the day', () => {
  // Oct 5 starts at 7pm (19:00) and runs to 1am. It must NOT count as a late start.
  const oct5 = entries.find((e) => e.date === '2026-10-05');
  assert.equal(oct5.timeBlocks[0].startMinutes, 19 * 60);
  assert.ok(oct5.timeBlocks[0].startMinutes < LATE_START_THRESHOLD_MIN);
  assert.ok(!m.lateStartDays.includes('2026-10-05'), 'a 7pm start is not late');

  // Only Oct 6 and Oct 8 begin after 9pm -> 2 of 5 logged days.
  assert.deepEqual(m.lateStartDays, ['2026-10-06', '2026-10-08']);
  assert.equal(m.lateStartRate, 40);
});

test('linearSlope detects direction', () => {
  assert.equal(linearSlope([]), null);
  assert.equal(linearSlope([1]), null);
  assert.equal(linearSlope([1, 1, 1]), 0);
  assert.ok(linearSlope([1, 2, 3]) > 0);
  assert.ok(linearSlope([3, 2, 1]) < 0);
});

test('machine-written blocker days are reported so the AI can skip them', () => {
  assert.deepEqual(m.machineWrittenBlockerDays, ['2026-10-07']);
});

test('the repeat plan is counted', () => {
  assert.equal(m.planRepeatCount, 1);
});

test('asOf is injectable — metrics are deterministic', () => {
  const earlier = calculateMetrics({ entries, month: '2026-10', asOf: '2026-10-09' });
  assert.equal(earlier.daysElapsed, 9);
  assert.equal(earlier.daysRemaining, 22);
  assert.equal(earlier.consistencyRate, 55.56);
});