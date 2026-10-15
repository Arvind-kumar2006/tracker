/**
 * Regression suite for PRD findings F1-F6, written against the REAL October_Accountability-2.xlsx.
 * These tests are the contract: if a refactor breaks the minutes-vs-hours decision or the
 * midnight-crossing parse, this file fails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkbook, listSpreadsheets } from '../src/infrastructure/persistence/xlsx/xlsxReader.js';
import {
  normalizeWorkbook,
  excelSerialToDate,
  detectHeaderRow,
  parsePlanItems,
  segmentBlockers,
  looksLikeMachineAdvice,
  reconcileWithUserSummary,
} from '../src/domain/services/WorkbookNormalizer.js';
import { parseTimeBlocks, parseTimeBlockLine } from '../src/domain/services/TimeBlockParser.js';
import { inferColumnUnit, corroborateAgainstReportedTotal, toMinutes, Unit } from '../src/domain/services/UnitInference.js';
import { parseTargetMet, parseBuildOutcome, TargetMet, BuildOutcome } from '../src/domain/entities/valueObjects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(__dirname, '../../October_Accountability-2.xlsx');

let result;
let raw;

test('setup: real workbook loads and normalises', async () => {
  raw = await readWorkbook(WORKBOOK);
  result = normalizeWorkbook({ rows: raw.sheets[0].rows, fileName: raw.fileName });
  assert.ok(result.entries.length > 0);
});

/* ---------------- F1: units ---------------- */

test('F1: header lies about "(h)" but values are minutes', () => {
  const genai = result.meta.unitDecisions.GENAI;
  assert.equal(genai.unit, Unit.MINUTES);
  assert.ok(genai.confidence >= 0.95);
});

test('F1: column-level inference, not per-cell', () => {
  // A single 100 in the month must flip the whole GENAI column, not just that row.
  assert.equal(result.meta.unitDecisions.GENAI.unit, Unit.MINUTES);
  assert.equal(result.meta.unitDecisions.CODING.unit, Unit.MINUTES);
});

test('F1: inferred minutes reproduce the reported totals exactly', () => {
  const withMinutes = result.entries.filter((e) => e.hasMinutes);
  assert.ok(withMinutes.length >= 4);
  for (const e of withMinutes) {
    assert.equal(e.variancePct, 0, `${e.date} variance should be 0%`);
  }
});

test('F1: unit inference rejects an all-hours column', () => {
  const r = inferColumnUnit([2, 3.5, 1, 0]);
  assert.equal(r.unit, Unit.HOURS);
  assert.ok(r.confidence > 0.8);
});

test('F1: an empty column is unverified, not confidently hours', () => {
  const r = inferColumnUnit([null, undefined, '']);
  assert.equal(r.confidence, 0);
  assert.match(r.reason, /no numeric values/i);
});

test('F1: toMinutes refuses to invent a number under UNKNOWN', () => {
  assert.equal(toMinutes(90, Unit.UNKNOWN), null);
  assert.equal(toMinutes(90, Unit.MINUTES), 90);
  assert.equal(toMinutes(1.5, Unit.HOURS), 90);
});

test('F1: corroboration detects the minutes reading', () => {
  const c = corroborateAgainstReportedTotal(105, 1.75);
  assert.equal(c.supported, true);
  assert.match(c.detail, /confirming minutes/);
});

/* ---------------- F2: empty days ---------------- */

test('F2: a 0 in Total never becomes "studied 0 hours"', () => {
  const empty = result.entries.filter((e) => !e.hasData);
  assert.ok(empty.length >= 20, `expected many empty days, got ${empty.length}`);
  for (const e of empty) {
    assert.equal(e.totalHoursComputed, null, `${e.date} must have a null total, not 0`);
  }
});

test('F2: empty days are marked SKIPPED, not MISSED', () => {
  const empty = result.entries.filter((e) => !e.hasData);
  for (const e of empty) {
    assert.notEqual(e.targetMet, TargetMet.MISSED);
  }
});

/* ---------------- F3/F4: closed enums ---------------- */

test('F3: "Floor" and "Minimum" are PARTIAL, "NO" is MISSED', () => {
  assert.equal(parseTargetMet('Floor', true).value, TargetMet.PARTIAL);
  assert.equal(parseTargetMet('Minimum', true).value, TargetMet.PARTIAL);
  assert.equal(parseTargetMet('NO', true).value, TargetMet.MISSED);
});

test('F3: an unrecognised status is NOT guessed', () => {
  const r = parseTargetMet('sort of', true);
  assert.equal(r.value, TargetMet.UNKNOWN);
  assert.equal(r.confidence, 0);
});

test('F4: build outcome reads all three real shapes', () => {
  assert.equal(parseBuildOutcome('Nothing').value, BuildOutcome.NONE);
  assert.equal(parseBuildOutcome('- learn to build').value, BuildOutcome.LEARNED);
  assert.equal(parseBuildOutcome("yes i build but it's vibe code but i know architecture").value, BuildOutcome.BUILT);
});

/* ---------------- F5: repeated plans ---------------- */

test('F5: byte-identical consecutive plans are flagged', () => {
  const repeat = result.entries.find((e) => e.plan.isRepeat);
  assert.ok(repeat, 'expected at least one repeated plan');
  assert.equal(repeat.plan.repeatOf, '2026-10-06');
});

/* ---------------- F6: time blocks ---------------- */

test('F6: a range crossing midnight gets the short plausible duration', () => {
  const { blocks } = parseTimeBlockLine('11:30 - 1:00 - jev model research');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].durationMin, 90, '11:30pm -> 1am is 90 minutes, not 13h50m');
  assert.equal(blocks[0].crossesMidnight, true);
  assert.equal(blocks[0].end, '1:00 am');
});

test('F6: 10:10pm -> 1:00am resolves to 170 minutes', () => {
  const { blocks } = parseTimeBlocks('10:10 - 1:00 - Image captioning - should be 2 hours complete');
  const b = blocks.at(-1);
  assert.equal(b.durationMin, 170);
  assert.equal(b.start, '10:10 pm');
  assert.equal(b.end, '1:00 am');
});

test('F6: an explicit meridiem is trusted, not guessed', () => {
  const { blocks } = parseTimeBlockLine('7 pm - 8 pm - mid sem prep');
  assert.equal(blocks[0].meridiemAssumed, false);
  assert.equal(blocks[0].durationMin, 60);
});

test('F6: 10pm - 12am is 120 minutes', () => {
  const { blocks } = parseTimeBlocks('10 - 12 am - OJT work of image captioning');
  assert.equal(blocks[0].durationMin, 120);
  assert.equal(blocks[0].end, '12:00 am');
});

test('F6: a crossed-out marker marks the block missed', () => {
  const { blocks } = parseTimeBlocks('7 to 8 - english conversion ❌');
  assert.equal(blocks[0].missed, true);
  assert.equal(blocks[0].done, false);
});

test('F6: a session summary line is skipped, not mangled into a block', () => {
  const { blocks, skipped } = parseTimeBlocks('hard start - 7 pm and hard stop at 1 am - 6 hours - 1 hour = 5 hours');
  assert.equal(blocks.length, 0);
  assert.equal(skipped.length, 1);
});

test('F6: a span longer than a plausible study block is rejected, not stored', () => {
  const { blocks, skipped } = parseTimeBlockLine('7 am - 9 pm - nonsense');
  assert.equal(blocks.length, 0, 'a 14-hour span is not a study block');
  assert.ok(skipped.length > 0);
  assert.match(skipped[0].reason, /duration/i);
});

/* ---------------- F7: anti-fabrication groundwork ---------------- */

test('F7: only 5 of 31 days carry data, so the rest must be inert', () => {
  assert.equal(result.meta.daysWithData, 5);
  assert.equal(result.entries.length, 31);
  const emptyDates = new Set(result.entries.filter((e) => !e.hasData).map((e) => e.date));
  for (const e of result.entries.filter((x) => x.hasData)) {
    assert.ok(!emptyDates.has(e.date));
  }
});

/* ---------------- F8: machine-written text ---------------- */

test('F8: prior AI advice is detected and user writing is not', () => {
  const flagged = result.entries.filter((e) => e.blockers.machineWritten);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].date, '2026-10-07');

  // Real user writing must never be mistaken for machine text.
  for (const date of ['2026-10-05', '2026-10-06', '2026-10-08']) {
    const e = result.entries.find((x) => x.date === date);
    assert.equal(e.blockers.machineWritten, false, `${date} is the user's own writing`);
  }
});

test('F8: "2 AM" is not mistaken for first person', () => {
  assert.equal(looksLikeMachineAdvice("Don't use 2 AM as proof that you can study effectively."), true);
  assert.equal(looksLikeMachineAdvice('i slept 7:20 to 8 pm but still felt tired'), false);
});

/* ---------------- header detection ---------------- */

test('header row is detected on row 4, not row 1', () => {
  assert.equal(result.meta.headerRow, 4);
  assert.ok(result.meta.headerScore >= 12);
});

test('header detection rejects a sheet with no header row', () => {
  const d = detectHeaderRow([[1, 2, 3], [4, 5, 6]]);
  assert.equal(d.index, -1);
});

/* ---------------- Excel serial dates ---------------- */

test('Excel serial 46296 is 2026-10-01', () => {
  assert.equal(excelSerialToDate(46296), '2026-10-01');
  assert.equal(excelSerialToDate(46326), '2026-10-31');
});

test('an out-of-range serial returns null rather than a garbage date', () => {
  assert.equal(excelSerialToDate(-5), null);
  assert.equal(excelSerialToDate('not a number'), null);
});

/* ---------------- summary reconciliation ---------------- */

test("the user's own summary arithmetic matches our computation", () => {
  assert.deepEqual(result.summary, { daysLogged: 5, daysTargetMet: 0, totalHours: 7.7, avgHoursPerLoggedDay: 1.53 });
  assert.equal(result.agreement.agrees, true, JSON.stringify(result.agreement.mismatches));
});

test('a wrong unit would be caught by reconciliation', () => {
  // If the values had been read as hours instead of minutes, the month total would be 460h
  // against the user's recorded 7.7h. The check must notice.
  const bad = reconcileWithUserSummary(
    [{ hasData: true, totalHoursComputed: 75, targetMet: 'MET' }],
    { daysLogged: 1, totalHours: 7.7, avgHoursPerLoggedDay: 7.7 }
  );
  assert.equal(bad.agrees, false);
  assert.ok(bad.mismatches.some((m) => m.key === 'totalHours'));
});

/* ---------------- plan + blockers ---------------- */

test('plan items split on enumeration and pull out the declared total', () => {
  const p = parsePlanItems('1. Langchain lecture\n2. OJT work\n\nlangchain - 2 hours\n\n4 hours');
  assert.equal(p.items.length, 2);
  assert.equal(p.declaredHours, 4);
});

test('blockers split into individual statements', () => {
  const segs = segmentBlockers('Sleep till 1 hour from 7 to 8\n\nAte a lot of food\n\nTea only');
  assert.equal(segs.length, 3);
});

/* ---------------- folder listing ---------------- */

test('folder scan finds the workbook and skips Office lock files', async () => {
  const dir = path.dirname(WORKBOOK);
  const files = await listSpreadsheets(dir);
  assert.ok(files.some((f) => f.endsWith('October_Accountability-2.xlsx')));
  assert.ok(!files.some((f) => path.basename(f).startsWith('~$')));
  assert.ok(!files.some((f) => path.basename(f).startsWith('._')));
});

test('reading a missing directory raises a DomainError, not a raw fs error', async () => {
  await assert.rejects(() => listSpreadsheets('/definitely/not/here'), (e) => e.name === 'DomainError');
});