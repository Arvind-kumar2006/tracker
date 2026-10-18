/**
 * Small, deterministic coaching output for the daily reflection screen.
 *
 * This is deliberately useful without an AI provider. The mobile app should never make a
 * saved reflection depend on an OpenRouter response being available.
 */

const asText = (value) => {
  if (value && typeof value === 'object') {
    return String(value.raw ?? value.text ?? value.segments?.join(' ') ?? '').trim();
  }
  return String(value ?? '').trim();
};

const shorten = (value, limit = 180) => {
  const text = asText(value).replace(/\s+/g, ' ');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
};

const withPeriod = (value) => /[.!?]$/.test(value) ? value : `${value}.`;

export function buildReflectionCoachFallback(entry = {}) {
  const accomplished = asText(entry.accomplished);
  const built = asText(entry.buildNote);
  const blockers = asText(entry.blockers);
  const tomorrowChange = asText(entry.tomorrowChange);
  const hasNoBlocker = !blockers || /^(nothing|none|no obstacles?)$/i.test(blockers);

  return {
    observation: accomplished
      ? withPeriod(`You recorded this accomplishment: ${shorten(accomplished)}`)
      : built
        ? withPeriod(`You recorded this output: ${shorten(built)}`)
        : 'No clear accomplishment was recorded today.',
    obstaclePattern: hasNoBlocker
      ? 'No clear obstacle pattern was recorded today.'
      : withPeriod(`The obstacle you recorded was: ${shorten(blockers)}`),
    tomorrowSuggestion: tomorrowChange
      ? withPeriod(`Keep tomorrow focused on: ${shorten(tomorrowChange)}`)
      : 'Choose one small first action and start it before opening distracting apps.',
  };
}

