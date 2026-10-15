/**
 * Daily-entry writes from the mobile app.
 *
 * The .xlsx file is an artefact the user owns; the app never rewrites it. Entries logged in the
 * app are stored as first-class Mongo documents keyed by date, so the next workbook import
 * reconciles rather than conflicts — the import is an upsert on the same natural key.
 */

import express from 'express';
import { ok, err } from '../../shared/result.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { TargetMet, BuildOutcome, parseTargetMet, parseBuildOutcome } from '../../domain/entities/valueObjects.js';
import { calculateMetrics } from '../../domain/services/MetricsCalculator.js';
import { extractConstraints } from '../../domain/services/ConstraintExtractor.js';
import { container, bootstrap } from '../../shared/di/container.js';

const MAX_FIELD = 4000;

/**
 * The app sends closed enums, so validate them as enums.
 *
 * Routing an enum through the free-text parser would be wrong: `parseBuildOutcome('BUILT')`
 * looks for prose patterns like "yes i built ..." and returns UNKNOWN for the bare word. Free
 * text from a spreadsheet still goes through the parser; an app tap does not.
 */
function coerceEnum(value, allowed, textParser) {
  if (value === null || value === undefined || value === '') return null;
  const upper = String(value).trim().toUpperCase();
  if (allowed.includes(upper)) return upper;
  return textParser(String(value)).value;
}

/**
 * Build the canonical DayEntry from app input. Kept pure and exported so it is testable.
 * Everything a user can set from the app is explicit; nothing is inferred or invented.
 */
export function buildEntryFromInput({ date, payload }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
    throw new DomainError(ErrorCode.UNPARSEABLE_VALUE, `invalid date "${date}"`);
  }

  const clamp = (s) => (s === null || s === undefined ? '' : String(s).slice(0, MAX_FIELD));

  const accomplished = clamp(payload.accomplished);
  const blockerText = clamp(payload.blockers);
  const buildOutcome = coerceEnum(payload.buildOutcome, Object.values(BuildOutcome), parseBuildOutcome);
  const targetMet = coerceEnum(payload.targetMet, Object.values(TargetMet), parseTargetMet);

  const declaredHours =
    payload.plannedHours === null || payload.plannedHours === undefined || payload.plannedHours === ''
      ? null
      : Number(payload.plannedHours);

  // Phase 7: 5-question reflection fields
  const floorHit = payload.floorHit === null || payload.floorHit === undefined || payload.floorHit === ''
    ? null
    : Boolean(payload.floorHit);
  const floorHitReason = clamp(payload.floorHitReason);
  const planBend = clamp(payload.planBend);

  const segments = blockerText
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hasData =
    accomplished !== '' ||
    segments.length > 0 ||
    buildOutcome !== null ||
    targetMet !== null ||
    floorHit !== null ||
    planBend !== '';

  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  return {
    date,
    month: date.slice(0, 7),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday],
    sheetRow: null,
    // An app-written entry has no spreadsheet provenance. That matters: `sourceFile: null`
    // keeps it distinguishable from an imported row rather than masquerading as one.
    sourceFile: null,
    hasData,
    hasMinutes: false,
    plan: { items: [], summary: '', declaredHours, isRepeat: false },
    minutes: { genaiMinutes: null, codingMinutes: null, englishMinutes: null, otherMinutes: null },
    totalHoursComputed: null,
    totalHoursReported: null,
    variancePct: null,
    totalWarning: null,
    targetMet,
    accomplished,
    buildOutcome,
    buildNote: '',
    blockers: { raw: blockerText, segments, machineWritten: false },
    tomorrowChange: clamp(payload.tomorrowChange),
    // Phase 7: 5-question reflection fields
    floorHit,
    floorHitReason,
    planBend,
    timeBlocks: [],
    origin: 'app',
  };
}

export async function saveDailyEntry({ date, payload, repositories }) {
  const { dailyLogRepository, monthRepository } = repositories;

  let entry;
  try {
    entry = buildEntryFromInput({ date, payload });
  } catch (e) {
    return err(e instanceof DomainError ? e : new DomainError(ErrorCode.UNPARSEABLE_VALUE, e.message));
  }

  const write = await dailyLogRepository.upsertMany([entry], { fileName: null });

  // Keep the month rollup consistent with the write.
  const entries = await dailyLogRepository.findByMonth(entry.month);
  const metrics = calculateMetrics({ entries, month: entry.month, asOf: new Date().toISOString().slice(0, 10) });
  const existing = await monthRepository.find(entry.month);
  await monthRepository.upsert(entry.month, metrics, existing?.monthlyGoal ?? null, existing?.targetDailyHours ?? null);

  const saved = await dailyLogRepository.findByDate(date);
  return ok({
    date,
    written: write,
    entry: saved,
    // Surfaced so the app can tell the user their new entry is eligible for analysis.
    constraints: extractConstraints(entries).length,
  });
}

export function dailyEntryRouter() {
  const router = express.Router();

  router.put('/api/days/:date', async (req, res) => {
    await bootstrap();
    const result = await saveDailyEntry({
      date: req.params.date,
      payload: req.body ?? {},
      repositories: {
        dailyLogRepository: container.dailyLogRepository,
        monthRepository: container.monthRepository,
      },
    });
    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });
    res.json(result.value);
  });

  return router;
}

export { TargetMet, BuildOutcome };