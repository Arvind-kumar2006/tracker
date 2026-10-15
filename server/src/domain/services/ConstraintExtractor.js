/**
 * ConstraintExtractor — turns free-text study rules into machine-checkable constraints.
 *
 * Column M of the reference workbook states several hard rules in passing:
 *
 *   "Can't study after the 12 am"
 *   "Milk should be at last after the completion"
 *   "Lecture are boring so can be keep it at last"
 *   "Tea only we complete 2 slots of 50 mins"
 *   "no sleep after the 7 pm to 8 pm"
 *
 * These are the user's own operating rules. PRD FR-5.4 requires that a generated study plan
 * respect them, and InsightValidator needs them in a structured form to check that. Extraction
 * is deterministic and conservative: anything not confidently recognised stays `type: 'NOTE'`
 * and is shown to the user but never used to reject a plan.
 */

const TIME_TOKEN = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?`;

/**
 * The user's writing uses typographic apostrophes — "Can’t study after the 12 am" is U+2019,
 * not ASCII. Matching against the raw string silently finds nothing, so normalise first.
 */
function normalise(s) {
  return String(s ?? '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

function clockToMinutes(h, m, meridiem) {
  let hour = Number(h);
  const minute = m ? Number(m) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) return null;
  const mer = meridiem?.toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  else if (mer === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/** "after the 12 am" / "after 1 am" -> minutes from midnight. Defaults midnight for bare "12". */
function parseClockAfter(text, matchIndex) {
  const slice = text.slice(matchIndex, matchIndex + 24);
  const m = slice.match(new RegExp(TIME_TOKEN));
  if (!m) return null;
  return clockToMinutes(m[1], m[2], m[3]);
}

/**
 * @param {Array} entries - normalised days
 * @returns {Array<{type, text, sourceDate, notAfterMinutes?, bans?}>}
 */
export function extractConstraints(entries) {
  const found = new Map(); // normalised text -> constraint, so repeats collapse into one

  const push = (c) => {
    if (!c || !c.text) return;
    const key = `${c.type}:${c.text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    if (found.has(key)) {
      // Record that the same rule was stated more than once — repetition signals importance.
      found.get(key).timesStated += 1;
      return;
    }
    found.set(key, { timesStated: 1, ...c });
  };

  for (const entry of entries) {
    if (!entry.hasData) continue;

    // A cell already containing AI-written coaching is not the user's own rule. Extracting
    // "2h/day is non-negotiable" as if they had written it would launder a previous tool's
    // output back in as a hard constraint.
    if (entry.blockers?.machineWritten) continue;

    const statements = (entry.blockers?.segments ?? []).filter(Boolean);
    // Only fall back to the whole cell when segmentation produced nothing. Pushing `raw`
    // alongside the segments re-derives the same statements as one giant blob, producing
    // duplicate constraints like a three-line "TIME_WINDOW" built from unrelated sentences.
    if (statements.length === 0 && entry.blockers?.raw) statements.push(entry.blockers.raw);

    for (const raw of statements) {
      // Keep the ORIGINAL text for display, but match against the normalised form.
      const original = String(raw ?? '').trim();
      if (original === '') continue;
      const text = normalise(original);

      // --- TIME_WINDOW: "can't study after the 12 am" ---
      const cannotAfter = text.match(
        new RegExp(String.raw`(?:can'?t|cannot|can not|unable to|not able to)\s+\w+.{0,18}?\bafter\b\s*(?:the\s*)?${TIME_TOKEN}`, 'i')
      );
      if (cannotAfter) {
        const idx = text.toLowerCase().indexOf('after', cannotAfter.index);
        const mins = parseClockAfter(text, idx);
        if (mins !== null) {
          push({ type: 'TIME_WINDOW', notAfterMinutes: mins, text: original, sourceDate: entry.date });
        }
      }

      // --- ORDERING: "milk should be at last", "keep it at last" ---
      if (/\b(at last|atleast|at the end|last thing)\b/i.test(text) || /\bshould be (?:at )?last\b/i.test(text)) {
        push({ type: 'ORDERING', text: original, sourceDate: entry.date });
      }

      // --- PROHIBITION: "no sleep after the 7 pm to 8 pm", "don't nap" ---
      const prohibition = text.match(
        new RegExp(String.raw`\b(no|don'?t|do not|never|avoid|stop)\b\s+(sleep|nap|napping|scrolling|phone|reels|series|binge)\b`, 'i')
      );
      if (prohibition) {
        push({
          type: 'PROHIBITION',
          bans: [prohibition[2].toLowerCase()],
          text: original,
          sourceDate: entry.date,
        });
      }

      // --- EXCLUSIVITY: "tea only", "50/10 only" ---
      if (/\bonly\b/i.test(text) && text.length < 120) {
        push({ type: 'EXCLUSIVITY', text: original, sourceDate: entry.date });
      }

      // --- Anything else is a note: shown, never enforced. ---
      if (
        !/\bafter\b/i.test(text) &&
        !/\b(at last|atleast|at the end|last thing)\b/i.test(text) &&
        !/\b(no|don'?t|do not|never|avoid|stop)\b\s+(sleep|nap|napping|scrolling|phone|reels|series|binge)\b/i.test(text)
      ) {
        push({ type: 'NOTE', text: original, sourceDate: entry.date });
      }
    }
  }

  return [...found.values()];
}

/** Human-readable one-liners for the UI and the prompt. */
export function describeConstraints(constraints) {
  const label = {
    TIME_WINDOW: 'latest finish',
    ORDERING: 'ordering rule',
    PROHIBITION: 'avoid',
    EXCLUSIVITY: 'only',
    NOTE: 'note',
  };
  return constraints.map((c) => ({
    ...c,
    label: c.notAfterMinutes !== undefined
      ? `${label.TIME_WINDOW} ${String(Math.floor(c.notAfterMinutes / 60)).padStart(2, '0')}:${String(c.notAfterMinutes % 60).padStart(2, '0')}`
      : label[c.type] ?? 'note',
  }));
}