/**
 * Plan-critique view-model tests. Pure functions, plain node.
 *
 * Uses the actual critique shape the analysis graph emits, including the real under-scoping
 * case from the October data (declared 4h, logged 2.08h).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AXIS_ORDER, AXES, band, BAND_LABEL, critiqueSummary, expandBlocks, formatClock,
  critiqueStats, sortCritiques, overallBand,
} from '../src/domain/planCritique.js';

const octoberCritiques = [
  {
    date: '2026-10-06',
    overall: 5,
    axes: {
      specific: { score: 8, note: 'named tasks' },
      timeboxed: { score: 9, note: 'has durations' },
      measurable: { score: 6, note: 'vague done-ness' },
      realistic: { score: 2, note: 'declared 4h, logged 1.67h' },
    },
    issues: ['Declared 4 hours but delivered 1.67 hours'],
    rewrittenBlocks: [
      { label: 'LangChain lecture', start: '7:00 pm', durationMin: 120 },
      { label: 'OJT work', start: '9:00 pm', durationMin: 60 },
    ],
    summary: 'Well-structured, consistently under-scoped.',
  },
  {
    date: '2026-10-07',
    overall: 6,
    axes: {
      specific: { score: 8, note: 'named tasks' },
      timeboxed: { score: 9, note: 'has durations' },
      measurable: { score: 6, note: 'vague' },
      realistic: { score: 3, note: 'declared 4h, logged 2.08h' },
    },
    issues: ['Declared 4 hours, delivered 2.08 hours'],
    rewrittenBlocks: [{ label: 'LangChain lecture', start: '7:00 pm', durationMin: 120 }],
    summary: 'Structured but under-scoped.',
  },
];

/* ---------------- bands ---------------- */

test('band thresholds split 0-10 sensibly', () => {
  assert.equal(band(10), 'strong');
  assert.equal(band(7), 'strong');
  assert.equal(band(6), 'fair');
  assert.equal(band(4), 'fair');
  assert.equal(band(3), 'weak');
  assert.equal(band(0), 'weak');
});

test('a missing score is treated as unknown, not zero-good', () => {
  assert.equal(band(undefined), 'weak');
  assert.equal(overallBand(null), 'weak');
});

test('every axis has a question and both explanations', () => {
  for (const key of AXIS_ORDER) {
    assert.ok(AXES[key].label, `${key} needs a label`);
    assert.ok(AXES[key].question.length > 10, `${key} needs a real question`);
    assert.ok(AXES[key].lowMeans, `${key} needs lowMeans`);
    assert.ok(AXES[key].highMeans, `${key} needs highMeans`);
  }
});

/* ---------------- summary ---------------- */

test('the summary names the weakest axis, not just the score', () => {
  const s = critiqueSummary(octoberCritiques[0]);
  assert.match(s, /weakest on realistic \(2\/10\)/i);
  assert.match(s, /Workable with gaps/);
});

test('a strong plan reads as keepable', () => {
  const s = critiqueSummary({ overall: 9, axes: { specific: { score: 9 }, timeboxed: { score: 9 }, measurable: { score: 9 }, realistic: { score: 9 } } });
  assert.match(s, /A plan you can keep/);
});

test('a missing critique does not throw', () => {
  assert.equal(typeof critiqueSummary(null), 'string');
  assert.equal(typeof critiqueSummary({}), 'string');
});

/* ---------------- clock expansion ---------------- */

test('formatClock handles noon and midnight correctly', () => {
  assert.equal(formatClock(0), '12:00 am');
  assert.equal(formatClock(12 * 60), '12:00 pm');
  assert.equal(formatClock(13 * 60 + 30), '1:30 pm');
  assert.equal(formatClock(23 * 60 + 45), '11:45 pm');
  assert.equal(formatClock(1440), '12:00 am', 'a 24h clock wraps');
});

test('a rewritten block gets an end time computed from its duration', () => {
  const [first] = expandBlocks([{ label: 'LangChain lecture', start: '7:00 pm', durationMin: 120 }]);
  assert.equal(first.start, '7:00 pm');
  assert.equal(first.end, '9:00 pm');
  assert.equal(first.crossesMidnight, false);
});

test('a block crossing midnight is flagged', () => {
  const [b] = expandBlocks([{ label: 'Late review', start: '11:00 pm', durationMin: 180 }]);
  assert.equal(b.end, '2:00 am');
  assert.equal(b.crossesMidnight, true);
});

test('an unparseable start does not crash the screen', () => {
  const [b] = expandBlocks([{ label: 'x', start: 'whenever', durationMin: 60 }]);
  assert.equal(b.end, null);
});

test('expandBlocks tolerates missing input', () => {
  assert.deepEqual(expandBlocks(), []);
  assert.deepEqual(expandBlocks(null), []);
});

/* ---------------- aggregate ---------------- */

test('stats aggregate across days and expose the weakest axis', () => {
  const s = critiqueStats(octoberCritiques);
  assert.equal(s.days, 2);
  assert.equal(s.overallAvg, 5.5);
  assert.equal(s.byAxis.realistic, 2.5);
  assert.equal(s.byAxis.specific, 8);
  assert.equal(s.weakestAxis, 'realistic', 'realistic is the axis that needs work here');
});

test('stats surface the largest declared-vs-actual gap', () => {
  const s = critiqueStats(octoberCritiques);
  assert.ok(s.biggestGap);
  assert.match(s.biggestGap.text, /Declared 4 hours/);
  assert.ok(['2026-10-06', '2026-10-07'].includes(s.biggestGap.date));
});

test('stats on an empty set are null, not zero', () => {
  const s = critiqueStats([]);
  assert.equal(s.days, 0);
  assert.equal(s.overallAvg, null, 'no average is not an average of zero');
  assert.equal(s.weakestAxis, null);
});

test('stats on null input do not throw', () => {
  assert.equal(critiqueStats(null).days, 0);
  assert.equal(critiqueStats(undefined).days, 0);
});

test('stats ignore malformed rows rather than producing NaN', () => {
  const s = critiqueStats([...octoberCritiques, null, {}, { date: '2026-10-08' }]);
  assert.equal(s.days, 3, 'rows without usable data are excluded');
  assert.equal(s.byAxis.realistic, 2.5, 'a row with no axes must not poison the average');
  assert.ok(!Number.isNaN(s.overallAvg));
});

/* ---------------- ordering ---------------- */

test('critiques sort newest first', () => {
  const s = sortCritiques(octoberCritiques);
  assert.equal(s[0].date, '2026-10-07');
});

test('sortCritiques does not mutate its input', () => {
  const input = [...octoberCritiques];
  sortCritiques(input);
  assert.equal(input[0].date, '2026-10-06');
});

test('BAND_LABEL covers every band the code can produce', () => {
  for (const b of ['strong', 'fair', 'weak']) assert.ok(BAND_LABEL[b], `missing label for ${b}`);
});