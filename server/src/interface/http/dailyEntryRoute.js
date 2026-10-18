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
  const buildNote = clamp(payload.buildNote);
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
    buildNote !== '' ||
    segments.length > 0 ||
    buildOutcome !== null ||
    targetMet !== null ||
    floorHit !== null ||
    floorHitReason !== '' ||
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
    buildNote,
    buildOutcome,
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

export async function saveDailyEntry({ date, payload, repositories, sheetsSync = null }) {
  const { dailyLogRepository, monthRepository } = repositories;
  const existing = await dailyLogRepository.findByDate(date);

  let entry;
  try {
    entry = buildEntryFromInput({ date, payload });
  } catch (e) {
    return err(e instanceof DomainError ? e : new DomainError(ErrorCode.UNPARSEABLE_VALUE, e.message));
  }

  // Reflection is a partial update. Preserve imported plans, time blocks, measured minutes, and
  // provenance instead of replacing them with the empty values used by the reflection payload.
  if (existing) {
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    entry = {
      ...existing,
      ...entry,
      // Reflection is a partial update. Preserve fields that this compact four-question form
      // does not expose, while still accepting them from older clients when they are present.
      buildOutcome: has('buildOutcome') ? entry.buildOutcome : existing.buildOutcome,
      buildNote: has('buildNote') ? entry.buildNote : existing.buildNote,
      floorHit: has('floorHit') ? entry.floorHit : existing.floorHit,
      floorHitReason: has('floorHitReason') ? entry.floorHitReason : existing.floorHitReason,
      planBend: has('planBend') ? entry.planBend : existing.planBend,
      // `plannedHours` is a legacy reflection field. If it is submitted, update only the
      // declared-hours value and keep the actual task list from the existing plan.
      plan: Object.prototype.hasOwnProperty.call(payload, 'plannedHours')
        ? { ...(existing.plan ?? entry.plan), declaredHours: entry.plan.declaredHours }
        : existing.plan,
      minutes: existing.minutes ?? entry.minutes,
      timeBlocks: existing.timeBlocks ?? entry.timeBlocks,
      sourceFile: existing.sourceFile ?? entry.sourceFile,
      origin: existing.origin ?? entry.origin,
      hasData: Boolean(existing.hasData || entry.hasData),
    };
  }

  // A changed reflection invalidates the previous per-day analysis. Keep the original answers
  // and all recorded plan/focus data, but force the next quality request to analyse the new text.
  entry.reflectionAnalysis = null;

  const write = await dailyLogRepository.upsertMany([entry], { fileName: null });

  // Keep the month rollup consistent with the write.
  const entries = await dailyLogRepository.findByMonth(entry.month);
  const metrics = calculateMetrics({ entries, month: entry.month, asOf: new Date().toISOString().slice(0, 10) });
  const existingMonth = await monthRepository.find(entry.month);
  await monthRepository.upsert(entry.month, metrics, existingMonth?.monthlyGoal ?? null, existingMonth?.targetDailyHours ?? null);

  const saved = await dailyLogRepository.findByDate(date);

  // Mongo is the source of truth. Mirror to Sheets after the durable write, but never turn a
  // successful journal save into a failure just because Google is temporarily unavailable.
  let sheets = { synced: false, skipped: true };
  if (sheetsSync) {
    try {
      const mirror = await sheetsSync(entry.month);
      sheets = mirror?.ok
        ? { synced: true, totals: mirror.value?.totals ?? null }
        : { synced: false, error: mirror?.error?.message ?? 'Google Sheets sync failed' };
    } catch (e) {
      sheets = { synced: false, error: e.message };
    }
  }

  return ok({
    date,
    written: write,
    entry: saved,
    sheets,
    // Surfaced so the app can tell the user their new entry is eligible for analysis.
    constraints: extractConstraints(entries).length,
  });
}

export function dailyEntryRouter() {
  const router = express.Router();

  router.get('/api/days/:date', async (req, res) => {
    await bootstrap();
    const entry = await container.dailyLogRepository.findByDate(req.params.date);
    if (!entry) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `No entry exists for ${req.params.date}.` },
      });
    }
    res.json(entry);
  });

  router.put('/api/days/:date', async (req, res) => {
    await bootstrap();
    const result = await saveDailyEntry({
      date: req.params.date,
      payload: req.body ?? {},
      repositories: {
        dailyLogRepository: container.dailyLogRepository,
        monthRepository: container.monthRepository,
      },
      sheetsSync: (month) => container.syncMonthToSheets(month),
    });
    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });
    res.json(result.value);
  });

  return router;
}

export { TargetMet, BuildOutcome };
