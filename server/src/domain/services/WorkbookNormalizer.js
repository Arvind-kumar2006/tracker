/**
 * WorkbookNormalizer — the correctness core of Phase 1.
 *
 * Takes raw SheetJS rows (which is what the xlsx reader returns) and produces canonical
 * DayEntry records plus a quarantine list. Pure: no I/O, no database, no LLM.
 *
 * Every ambiguity is resolved from evidence and recorded with a confidence and a human-readable
 * reason. Nothing is guessed silently — the quarantine contract in PRD FR-2.14 forbids it.
 */

import { DomainError, ErrorCode } from '../errors/DomainError.js';
import { CATEGORY_COLUMN, CATEGORY_FIELD, StudyCategory } from '../entities/studyCategory.js';
import { parseTargetMet, parseBuildOutcome, TargetMet, BuildOutcome } from '../entities/valueObjects.js';
import { Unit, inferColumnUnit, corroborateAgainstReportedTotal, toMinutes, toNumeric } from './UnitInference.js';
import { parseTimeBlocks } from './TimeBlockParser.js';

/** Excel's 1900 date system starts from this date for serial 1. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/** Convert an Excel serial (46296) to "2026-10-01". */
export function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1 || n > 2958466) return null;
  // Floor handles Excel's fractional day component (it encodes time of day).
  const days = Math.floor(n);
  const ms = EXCEL_EPOCH_UTC + days * MS_PER_DAY;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function weekdayOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Column signatures used for header detection and column mapping (FR-1.5).
 * The reference workbook puts its headers on row 4, not row 1 — assuming row 1 silently
 * produces garbage, so detection is a scored scan.
 */
export const COLUMN_SIGNATURES = Object.freeze({
  A: { key: 'date', required: true, patterns: [/^date$/i, /^day$/i] },
  B: { key: 'weekday', required: false, patterns: [/^day$/i] },
  C: { key: 'plan', required: true, patterns: [/planned/i, /goal/i, /today/i] },
  D: { key: 'genai', required: false, patterns: [/genai/i, /gen\s*ai/i, /\bai\b/i] },
  E: { key: 'coding', required: false, patterns: [/coding/i, /code/i, /dev/i] },
  F: { key: 'english', required: false, patterns: [/english/i] },
  G: { key: 'other', required: false, patterns: [/^other$/i, /others/i] },
  H: { key: 'timeBlocks', required: false, patterns: [/time\s*block/i, /^time$/i, /block/i] },
  I: { key: 'totalReported', required: false, patterns: [/^total/i, /total\s*\(h\)/i] },
  J: { key: 'targetMet', required: false, patterns: [/target/i, /met\?/i] },
  K: { key: 'accomplished', required: false, patterns: [/accomplish/i, /did\s*i/i] },
  L: { key: 'build', required: false, patterns: [/build/i, /created/i] },
  M: { key: 'blockers', required: false, patterns: [/block/i, /obstacle/i] },
  N: { key: 'tomorrowChange', required: false, patterns: [/tomorrow/i, /change/i] },
});

/**
 * Score each of the first `scanRows` rows as a candidate header row.
 * A row scores 1 per column whose text matches that column's signature. The best-scoring
 * row wins; ties break toward the earliest row.
 */
export function detectHeaderRow(rows, scanRows = 10) {
  const limit = Math.min(scanRows, rows.length);
  let best = { index: -1, score: 0, mapping: null };

  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    let score = 0;
    const mapping = {};

    for (const [col, sig] of Object.entries(COLUMN_SIGNATURES)) {
      const idx = colToIndex(col);
      const cell = row[idx];
      if (cell === null || cell === undefined) continue;
      const text = String(cell).trim();
      if (text === '') continue;
      if (sig.patterns.some((p) => p.test(text))) {
        score += 1;
        if (mapping[sig.key] === undefined) mapping[sig.key] = col;
      }
    }

    // A header row must at least identify the date and plan columns.
    if (mapping.date === undefined || mapping.plan === undefined) continue;

    if (score > best.score) best = { index: r, score, mapping };
  }

  return best;
}

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cell(row, mapping, key) {
  const col = mapping[key];
  if (col === undefined) return null;
  const v = row[colToIndex(col)];
  return v === undefined ? null : v;
}

function textOf(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

const isBlank = (v) => textOf(v) === '';

/* ------------------------------------------------------------------ *
 * Plan parsing (FR-2.9, finding F5)
 * ------------------------------------------------------------------ */

/** Split a plan cell into numbered items, tolerating blank lines and stray list markers. */
export function parsePlanItems(raw) {
  const text = textOf(raw);
  if (text === '') return { items: [], declaredHours: null, summary: '' };

  const lines = text.split(/\r?\n/);
  const items = [];
  let current = null;
  const tail = [];

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (line === '') continue;

    const m = line.match(/^(\d{1,2})[.)]\s*(.+)$/);
    if (m) {
      if (current) items.push(current);
      current = m[2].trim();
    } else if (/^\d+(?:\.\d+)?\s*(?:hours?|hrs?|h)\s*$/i.test(line)) {
      // A bare declared total on its own line, e.g. the trailing "4 hours" in the reference
      // workbook. This must be checked BEFORE the continuation branch, or it gets absorbed
      // into the previous plan item and corrupts it.
      tail.push(line);
    } else if (current && /^[a-z]{3,}\s*-\s*\d+\s*(mins?|hours?)/i.test(line)) {
      // A duration recap like "langchain - 2 hours" — belongs to the summary, not the items.
      tail.push(line);
    } else if (current) {
      current = `${current} ${line}`;
    } else {
      tail.push(line);
    }
  }
  if (current) items.push(current);

  // A trailing "4 hours" / "4.5 hours" declares the day's intended total.
  let declaredHours = null;
  for (const line of [...tail].reverse()) {
    const m = line.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
    if (m) {
      declaredHours = Number(m[1]);
      break;
    }
  }

  return {
    items: items.map((t, i) => ({ n: i + 1, text: t })),
    declaredHours,
    summary: items[0] ?? text.slice(0, 200),
  };
}

/** Stable hash for a plan, used to detect the byte-identical repeats of finding F5. */
function hashText(s) {
  let h = 5381;
  const str = s.toLowerCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/* ------------------------------------------------------------------ *
 * Blocker segmentation + prior-AI-text detection (FR-2.12, finding F8)
 * ------------------------------------------------------------------ */

/**
 * Detect text that a previous AI tool already wrote into the user's column.
 * Row 11 of the reference file contains exactly this.
 *
 * Signals: coaching vocabulary and second-person imperatives, combined with an absence of
 * first-person markers. Real user writing keeps the "i"/"my" typos.
 */
export function looksLikeMachineAdvice(text) {
  const t = textOf(text);
  if (t === '') return false;

  // Case-SENSITIVE on purpose: "2 AM" is a clock time, not first person. Journal writing uses
  // lowercase "i"/"my"; machine prose addresses the reader as "You" or "Don't".
  const firstPerson = /(?<![A-Za-z0-9])(?:i|i'm|i've|i'll|my|me)(?![A-Za-z0-9])/.test(t);
  const coachMarkers = [
    /\b(rather than|instead of|non-negotiable)\b/i,
    /\b(don't|do this|make sure|aim for|prioriti[sz]e)\b/i,
    /\bmeans\b.*\bblock\b/i,
    /^\s*example\s*:/im,
    /\buse buffers?\b/i,
    /\badd \d+\s*(?:-\s*\d+\s*)?min\b/i,
  ];
  const hasCoachMarkers = coachMarkers.some((p) => p.test(t));

  return hasCoachMarkers && !firstPerson;
}

/* ------------------------------------------------------------------ *
 * Summary block (discovered in the reference workbook below the data)
 * ------------------------------------------------------------------ */

const SUMMARY_LABELS = {
  'days logged': 'daysLogged',
  'days target met': 'daysTargetMet',
  'total hours this month': 'totalHours',
  'avg hours / logged day': 'avgHoursPerLoggedDay',
  'avg hours per logged day': 'avgHoursPerLoggedDay',
};

/**
 * The reference workbook carries a hand-written summary under the daily rows:
 *
 *   Summary
 *   Days logged              5
 *   Days target met          0
 *   Total hours this month   7.7
 *   Avg hours / logged day   1.53
 *
 * This is the user's own arithmetic, so it is the strongest available corroboration that the
 * minutes-versus-hours decision was right. It must be parsed out, not quarantined as a bad date.
 *
 * @returns {{index: number, values: object}}
 */
export function parseSummaryBlock(rows, startIndex) {
  const values = {};
  for (let i = startIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const label = textOf(row[0]).toLowerCase().replace(/\s*:?\s*$/, '');
    if (label === '') break;
    const key = SUMMARY_LABELS[label];
    if (!key) continue;
    const raw = toNumeric(row[1]);
    if (raw !== null) values[key] = raw;
  }
  return { index: startIndex, values };
}

/** Locate a trailing summary region, if the sheet has one. */
export function findSummaryRegion(rows) {
  const limit = Math.min(rows.length, 60);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (Array.isArray(row) && textOf(row[0]).toLowerCase() === 'summary') {
      return i;
    }
  }
  return -1;
}

/** Split a blockers cell into individual statements. */
export function segmentBlockers(raw) {
  const text = textOf(raw);
  if (text === '') return [];

  return text
    .split(/\r?\n+|(?:^|\s)[•]\s*|\s{3,}/)
    .map((s) => s.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter((s) => s !== '');
}

/* ------------------------------------------------------------------ *
 * Main normaliser
 * ------------------------------------------------------------------ */

/**
 * @param {object} opts
 * @param {Array<Array>} opts.rows - raw rows from the xlsx reader, header row included
 * @param {string} opts.fileName
 * @param {string} [opts.sheetName]
 * @returns {{entries: Array, quarantined: Array, meta: object}}
 */
export function normalizeWorkbook({ rows, fileName, sheetName = 'Sheet1' }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new DomainError(ErrorCode.FILE_NOT_READABLE, 'workbook has no rows');
  }

  const detected = detectHeaderRow(rows);
  if (detected.index === -1 || !detected.mapping) {
    throw new DomainError(
      ErrorCode.MISSING_HEADER,
      'could not locate a header row containing both a Date and a Planned column',
      { scannedRows: Math.min(10, rows.length) }
    );
  }

  const { mapping } = detected;
  const allRows = rows;

  // The reference workbook ends with a hand-written "Summary" block. Parse it first so those
  // rows are never mistaken for malformed daily entries, then stop the daily scan there.
  const summaryStart = findSummaryRegion(allRows);
  const summary = summaryStart === -1 ? null : parseSummaryBlock(allRows, summaryStart);
  const dataRows = summaryStart === -1 ? allRows.slice(detected.index + 1) : allRows.slice(detected.index + 1, summaryStart);

  const quarantined = [];
  const quarantine = (rowNumber, column, rawValue, reason, confidence = 0) => {
    quarantined.push({ fileName, sheetRow: rowNumber, column, rawValue: String(rawValue).slice(0, 500), reason, confidence });
  };

  /* --- Pass 1: column-level unit inference (FR-2.1..2.4) --- */
  // Done across the WHOLE column before per-row parsing, because a single outlier should not
  // flip the unit for the whole month.
  const unitDecisions = {};
  const categoryValuesByColumn = {};
  for (const [col, category] of Object.entries(CATEGORY_COLUMN)) {
    if (mapping[categoryKeyOf(category)] === undefined) continue;
    const colIdx = colToIndex(col);
    const values = dataRows.map((r) => (Array.isArray(r) ? r[colIdx] : null));
    categoryValuesByColumn[col] = values;
    unitDecisions[category] = inferColumnUnit(values);
  }

  // Provisional parse so totals can corroborate the unit choice (FR-2.1 / UnitInference).
  const provisionalMinutes = dataRows.map((row) => {
    let sum = 0;
    let any = false;
    for (const [col, category] of Object.entries(CATEGORY_COLUMN)) {
      const idx = colToIndex(col);
      const mins = toMinutes(row[idx], unitDecisions[category]?.unit ?? Unit.HOURS);
      if (mins !== null) {
        sum += mins;
        any = true;
      }
    }
    return any ? sum : null;
  });

  /* --- Pass 2: per-row normalisation --- */
  const entries = [];
  const planHashes = new Map();

  dataRows.forEach((row, i) => {
    const sheetRow = detected.index + 2 + i; // 1-based, header included
    if (!Array.isArray(row)) return;

    const rawDate = cell(row, mapping, 'date');
    if (isBlank(rawDate)) return; // trailing empty row

    const date = parseDateCell(rawDate);
    if (!date) {
      quarantine(sheetRow, mapping.date, rawDate, 'could not interpret as a date');
      return;
    }

    /* --- minutes + totals (FR-2.5, FR-2.6) --- */
    const minutes = {};
    let minutesSum = 0;
    let hasMinutes = false;
    for (const [col, category] of Object.entries(CATEGORY_COLUMN)) {
      const field = CATEGORY_FIELD[category];
      const idx = colToIndex(col);
      const mins = toMinutes(row[idx], unitDecisions[category]?.unit ?? Unit.HOURS);
      minutes[field] = mins;
      if (mins !== null) {
        minutesSum += mins;
        hasMinutes = true;
      }
    }

    const reportedRaw = cell(row, mapping, 'totalReported');
    const reportedHours = toNumeric(reportedRaw);

    // F2: a 0 in the Total column must never be read as "studied zero hours".
    const totalHoursComputed = hasMinutes ? round2(minutesSum / 60) : null;

    let variancePct = null;
    let totalWarning = null;
    if (hasMinutes && reportedHours !== null && reportedHours > 0) {
      variancePct = round2(((totalHoursComputed - reportedHours) / reportedHours) * 100);
      if (Math.abs(variancePct) > 5) {
        totalWarning = `computed ${totalHoursComputed}h vs reported ${reportedHours}h (${variancePct}% variance)`;
        quarantine(sheetRow, mapping.totalReported ?? 'I', reportedRaw, totalWarning, 1);
      }
    }

    /* --- content fields --- */
    const plan = parsePlanItems(cell(row, mapping, 'plan'));
    const planHash = plan.items.length ? hashText(plan.items.map((x) => x.text).join(' | ')) : null;
    if (planHash) {
      const seen = planHashes.get(planHash);
      if (seen) {
        plan.repeatOf = seen.date;
        plan.isRepeat = true;
      } else {
        planHashes.set(planHash, { date, sheetRow });
      }
    }

    const { blocks, skipped: skippedBlocks } = parseTimeBlocks(cell(row, mapping, 'timeBlocks'));
    for (const s of skippedBlocks) {
      quarantine(sheetRow, mapping.timeBlocks ?? 'H', s.text, `time block not parsed: ${s.reason}`, 0);
    }

    const blockerText = textOf(cell(row, mapping, 'blockers'));
    const blockerSegments = segmentBlockers(blockerText);
    const blockers = {
      raw: blockerText,
      segments: blockerSegments,
      machineWritten: looksLikeMachineAdvice(blockerText),
    };

    const hasData =
      plan.items.length > 0 ||
      hasMinutes ||
      !isBlank(cell(row, mapping, 'accomplished')) ||
      blockerSegments.length > 0 ||
      blocks.length > 0 ||
      !isBlank(cell(row, mapping, 'build')) ||
      !isBlank(cell(row, mapping, 'tomorrowChange'));

    // F3 / F4: closed enums, with unmapped values quarantined rather than guessed.
    const targetMet = parseTargetMet(cell(row, mapping, 'targetMet'), hasData);
    if (targetMet.confidence === 0) {
      quarantine(sheetRow, mapping.targetMet ?? 'J', cell(row, mapping, 'targetMet'), targetMet.reason, 0);
    }

    const buildRaw = cell(row, mapping, 'build');
    const build = parseBuildOutcome(buildRaw);
    if (build.confidence === 0) {
      quarantine(sheetRow, mapping.build ?? 'L', buildRaw, build.reason, 0);
    }

    entries.push({
      date,
      month: date.slice(0, 7),
      weekday: weekdayOf(date),
      sheetRow,
      hasData,
      hasMinutes,
      plan,
      minutes,
      units: Object.fromEntries(Object.entries(unitDecisions).map(([c, u]) => [c, u.unit])),
      totalHoursComputed,
      totalHoursReported: reportedHours,
      variancePct,
      totalWarning,
      targetMet: targetMet.value,
      targetMetConfidence: targetMet.confidence,
      accomplished: textOf(cell(row, mapping, 'accomplished')),
      buildOutcome: build.value,
      buildNote: textOf(buildRaw),
      blockers,
      tomorrowChange: textOf(cell(row, mapping, 'tomorrowChange')),
      timeBlocks: blocks,
      sourceFile: fileName,
    });
  });

  /* --- Pass 3: fold the corroboration result back into unit confidence (FR-2.1) --- */
  const corroborated = provisionalMinutes.some((sum, i) =>
    sum !== null && corroborateAgainstReportedTotal(sum, entries[i]?.totalHoursReported).supported
  );
  if (corroborated) {
    for (const d of Object.values(unitDecisions)) {
      if (d.unit === Unit.MINUTES) d.confidence = Math.min(1, d.confidence + 0.05);
      if (d.verified === undefined) d.verified = true;
    }
  }

  /* --- Pass 4: cross-check against the user's own summary arithmetic --- */
  const agreement = reconcileWithUserSummary(entries, summary?.values ?? null);

  const nonEmptyDataRows = dataRows.filter(
    (r) => Array.isArray(r) && r.some((v) => v !== null && String(v).trim() !== '')
  ).length;

  return {
    entries,
    quarantined,
    summary: summary?.values ?? null,
    agreement,
    meta: {
      fileName,
      sheetName,
      headerRow: detected.index + 1,
      headerScore: detected.score,
      columnMapping: mapping,
      unitDecisions,
      rowsScanned: allRows.length,
      rowsPopulated: nonEmptyDataRows,
      rowsTotal: dataRows.length,
      rowsParsed: entries.length,
      rowsQuarantined: quarantined.length,
      daysWithData: entries.filter((e) => e.hasData).length,
      months: [...new Set(entries.map((e) => e.month))].sort(),
      corroboratedTotals: corroborated,
      hasUserSummary: Boolean(summary),
    },
  };
}

/**
 * Compare our computed figures against the totals the user wrote by hand.
 * Disagreement is surfaced, never hidden — it is the earliest signal that a unit was misread.
 */
export function reconcileWithUserSummary(entries, userSummary) {
  if (!userSummary) return { checked: false };

  const withData = entries.filter((e) => e.hasData);
  const computedTotal = round2(withData.reduce((s, e) => s + (e.totalHoursComputed ?? 0), 0));
  const computedDaysLogged = withData.length;
  // Strictly MET. "Floor" and "Minimum" map to PARTIAL because the user hit a reduced bar,
  // and the reference summary confirms they do NOT count those as a met target (they recorded
  // 0 met days while three days carry a Floor/Minimum/NO value).
  const computedDaysMet = withData.filter((e) => e.targetMet === TargetMet.MET).length;
  const computedAvg = computedDaysLogged > 0 ? round2(computedTotal / computedDaysLogged) : null;

  const comparisons = [
    ['daysLogged', userSummary.daysLogged, computedDaysLogged],
    ['daysTargetMet', userSummary.daysTargetMet, computedDaysMet],
    ['totalHours', userSummary.totalHours, computedTotal],
    ['avgHoursPerLoggedDay', userSummary.avgHoursPerLoggedDay, computedAvg],
  ].filter(([, theirs]) => typeof theirs === 'number');

  const mismatches = [];
  for (const [key, theirs, ours] of comparisons) {
    const tolerance = key === 'daysLogged' || key === 'daysTargetMet' ? 0 : 0.05;
    const diff = ours === null ? null : Math.abs(ours - theirs);
    const agrees = diff !== null && diff <= (tolerance || 1);
    if (!agrees) mismatches.push({ key, userValue: theirs, computedValue: ours });
  }

  return {
    checked: true,
    agrees: mismatches.length === 0,
    comparisons: comparisons.map(([key, theirs, ours]) => ({ key, userValue: theirs, computedValue: ours })),
    mismatches,
  };
}

function categoryKeyOf(category) {
  return category === StudyCategory.OTHER ? 'other' : category.toLowerCase();
}

function parseDateCell(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return excelSerialToDate(v);
  const text = textOf(v);
  if (text === '') return null;
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

export { TargetMet, BuildOutcome, Unit };