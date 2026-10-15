/**
 * TimeBlockParser — resolves PRD finding F6.
 *
 * Column H of the real workbook mixes formats across rows:
 *   "hard start - 7 pm and hard stop at 1 am - 6 hours"   (session summary, not a block)
 *   "1. 7 to 8 - english conversion <crossed-out>"      (enumerated, "to" separator)
 *   "9 - 11 pm - langchain lecture"                      (single trailing meridiem)
 *   "9 - 10:30 pm - langchain lecuter"                   (half-hour end)
 *   "7-8 - mid sem prep"                                 (no meridiem at all)
 *   "10:10 - 1:00 - Image captioning - should be 2 hours complete"  (crosses midnight)
 *
 * Ambiguity is recorded, never silently resolved. Each block carries a confidence and, when the
 * meridiem was assumed, an explicit `meridiemAssumed` flag.
 */

/**
 * A time range: H, H.MM, H:MM, each with an optional meridiem. Separators: - (en/em dash), "to".
 */
const RANGE_RE =
  /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/gi;

/** Lines that summarise the whole session rather than describe one block. */
const SUMMARY_LINE_RE = /\b(hard\s+(start|stop)|session|total\s+window)\b/i;

/** Completion markers used inconsistently by the user. */
const DONE_RE = /[\u2705✓✔]|\b(done|completed|finished|shipped|attended)\b/i;
const MISSED_RE = /[\u274C\u2717✗]|\b(missed|skipped|relapsed|slept|did\s*n[o']t)\b/i;

const DEFAULT_MERIDIEM = 'pm'; // study sessions in this workbook run 7pm-1am

/**
 * Longest span we accept for a SINGLE study block. Anything longer is not a block — it is a
 * session window, and the session-summary line handler deals with those separately. The user's
 * real blocks run 60-170 minutes, so 6h is generous without admitting 14h nonsense.
 */
const MAX_SESSION_MINUTES = 6 * 60;

function buildTime(hourStr, minuteStr, meridiem) {
  let hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;

  if (!Number.isFinite(hour) || hour < 0 || hour > 24) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  else if (meridiem === 'am' && hour === 12) hour = 0;

  return hour * 60 + minute; // minutes from midnight
}

function formatClock(minutesFromMidnight) {
  const wrapped = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const meridiem = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${meridiem}`;
}

/**
 * Parse one line into zero or more time blocks.
 *
 * @param {string} line - raw line from column H
 * @param {{defaultMeridiem?: 'am'|'pm', allowNoMeridiem?: boolean}} [options]
 * @returns {{blocks: Array, skipped: Array<{text: string, reason: string}>}}
 */
export function parseTimeBlockLine(line, options = {}) {
  const { defaultMeridiem = DEFAULT_MERIDIEM, allowNoMeridiem = true } = options;

  if (line === null || line === undefined || String(line).trim() === '') {
    return { blocks: [], skipped: [] };
  }

  const text = String(line);
  const skipped = [];

  if (SUMMARY_LINE_RE.test(text)) {
    return { blocks: [], skipped: [{ text, reason: 'session summary line, not an individual block' }] };
  }

  // Strip leading list markers ("1. ", "2) ", "- ") so they don't leak into the first label.
  const cleaned = text.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '');
  if (!cleaned.trim()) return { blocks: [], skipped: [] };

  const matches = [];
  RANGE_RE.lastIndex = 0;
  let m;
  while ((m = RANGE_RE.exec(cleaned)) !== null) {
    matches.push({
      startHour: m[1],
      startMinute: m[2],
      startMeridiem: m[3] ? m[3].toLowerCase() : null,
      endHour: m[4],
      endMinute: m[5],
      endMeridiem: m[6] ? m[6].toLowerCase() : null,
      index: m.index,
      full: m[0],
    });
  }

  if (matches.length === 0) {
    skipped.push({ text, reason: 'no time range found' });
    return { blocks: [], skipped };
  }

  const blocks = [];

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];

    let startMer = cur.startMeridiem;
    let endMer = cur.endMeridiem;
    const endMeridiemExplicit = endMer !== null;

    if (!startMer && !endMer) {
      if (!allowNoMeridiem) {
        skipped.push({ text: cur.full, reason: 'no meridiem and assumption disabled' });
        continue;
      }
      startMer = endMer = defaultMeridiem;
    } else if (!endMer) {
      // "9 - 10:30 pm" -> the single meridiem governs both ends.
      endMer = startMer;
    } else if (!startMer) {
      // "9 pm - 11" -> derive start from end when the end meridiem is earlier in the day.
      startMer = endMer === 'am' && Number(cur.startHour) >= 7 ? 'pm' : endMer;
    }

    const startMin = buildTime(cur.startHour, cur.startMinute, startMer);

    // When the end meridiem was ASSUMED, "11:30 - 1:00" is genuinely ambiguous: it reads as
    // 11:30pm-1pm (13h50m, absurd) or 11:30pm-1am (90m, a normal study block). Resolve it by
    // picking the shorter plausible span instead of trusting the default.
    let endMin;
    let durationMin;
    let crossesMidnight = false;
    let meridiemAssumed = !endMeridiemExplicit || cur.startMeridiem === null;

    if (startMin === null) {
      skipped.push({ text: cur.full, reason: 'unparseable start time' });
      continue;
    }

    if (!endMeridiemExplicit) {
      const primary = buildTime(cur.endHour, cur.endMinute, endMer);
      const flipped = buildTime(cur.endHour, cur.endMinute, endMer === 'am' ? 'pm' : 'am');
      const span = (e) => (e === null ? null : e - startMin > 0 ? e - startMin : e - startMin + 1440);

      const candidates = [
        { end: primary, dur: span(primary) },
        { end: flipped, dur: span(flipped) },
      ].filter((c) => c.end !== null && c.dur > 0 && c.dur <= MAX_SESSION_MINUTES);

      if (candidates.length === 0) {
        skipped.push({ text: cur.full, reason: 'no plausible duration for the end time' });
        continue;
      }

      const best = candidates.reduce((a, b) => (b.dur < a.dur ? b : a));
      endMin = best.end;
      durationMin = best.dur;
      crossesMidnight = best.end < startMin;
    } else {
      endMin = buildTime(cur.endHour, cur.endMinute, endMer);
      if (endMin === null) {
        skipped.push({ text: cur.full, reason: 'unparseable end time' });
        continue;
      }
      durationMin = endMin - startMin;
      if (durationMin <= 0) {
        durationMin += 1440;
        crossesMidnight = true;
      }
    }

    // Guard against absurd spans produced by a mis-parsed range.
    if (durationMin > MAX_SESSION_MINUTES) {
      skipped.push({ text: cur.full, reason: `implausible duration of ${durationMin} minutes` });
      continue;
    }

    // Label = text between the end of this range and the start of the next one.
    const labelStart = cur.index + cur.full.length;
    const labelEnd = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
    const rawLabel = cleaned.slice(labelStart, labelEnd).replace(/^[\s\-–—:|]+/, '').trim();

    const done = DONE_RE.test(rawLabel);
    const missed = MISSED_RE.test(rawLabel);
    const label = rawLabel
      .replace(DONE_RE, '')
      .replace(MISSED_RE, '')
      .replace(/[\u2705✓✔\u274C\u2717✗]/g, '')
      .replace(/^\s*[\-–—:|]\s*/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    blocks.push({
      start: formatClock(startMin),
      end: formatClock(endMin),
      startMinutes: startMin,
      endMinutes: endMin,
      durationMin,
      crossesMidnight,
      label: label || '(unlabelled)',
      done: done && !missed,
      missed: missed && !done,
      meridiemAssumed,
      confidence: meridiemAssumed ? 0.6 : 0.95,
      raw: cur.full,
    });
  }

  return { blocks, skipped };
}

/**
 * Parse an entire column-H cell (which may span multiple lines) into blocks.
 * @returns {{blocks: Array, skipped: Array}}
 */
export function parseTimeBlocks(cellValue, options = {}) {
  const raw = cellValue === null || cellValue === undefined ? '' : String(cellValue);
  const lines = raw.split(/\r?\n|(?=\s*\d+[.)]\s)|;\s*/).map((l) => l.trim()).filter(Boolean);

  const blocks = [];
  const skipped = [];
  let seq = 0;

  for (const line of lines) {
    const parsed = parseTimeBlockLine(line, options);
    for (const b of parsed.blocks) {
      blocks.push({ seq: seq++, ...b });
    }
    skipped.push(...parsed.skipped);
  }

  return { blocks, skipped };
}