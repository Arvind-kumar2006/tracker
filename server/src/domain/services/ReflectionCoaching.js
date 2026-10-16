/**
 * Pure evidence and coaching helpers for a single daily reflection.
 *
 * The model may interpret these facts, but it may not invent the facts themselves. Every
 * coaching item therefore has to reference one of the stable ids produced here.
 */

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const text = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
};

const answerText = (value) => {
  if (value && typeof value === 'object') {
    if (value.raw !== undefined) return text(value.raw);
    if (Array.isArray(value.segments)) return value.segments.join(' ').trim();
    if (value.text !== undefined) return text(value.text);
    return '';
  }
  return text(value);
};

const planStats = (entry) => {
  const items = Array.isArray(entry?.plan?.items) ? entry.plan.items : [];
  const plannedMinutes = items.reduce((sum, item) => sum + number(item.estimatedMinutes), 0);
  const actualMinutes = items.reduce((sum, item) => sum + number(item.actualMinutes), 0);
  const completed = items.filter((item) => (
    item.status === 'DONE' || (number(item.estimatedMinutes) > 0 && number(item.actualMinutes) >= number(item.estimatedMinutes))
  )).length;
  return { items, plannedMinutes, actualMinutes, completed };
};

const sessionStats = (entry) => {
  const sessions = Array.isArray(entry?.focusSessions) ? entry.focusSessions : [];
  return {
    count: sessions.length,
    minutes: sessions.reduce((sum, session) => sum + number(session.durationMinutes), 0),
    interrupted: sessions.filter((session) => session.interrupted).length,
  };
};

const addFact = (facts, id, factText, kind = 'recorded') => {
  if (!factText) return;
  facts.push({ id, text: factText, kind });
};

/** Build only facts that can be verified from the supplied documents. */
export function buildReflectionEvidence({ entry = {}, history = [] } = {}) {
  const facts = [];
  const plan = planStats(entry);
  const sessions = sessionStats(entry);
  const prior = (Array.isArray(history) ? history : [])
    .filter((day) => day?.hasData && day.date && day.date !== entry.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-14);

  addFact(facts, 'today.plan.count', `Today had ${plan.items.length} ${plan.items.length === 1 ? 'priority' : 'priorities'}.`);
  if (plan.items.length) {
    addFact(facts, 'today.plan.completed', `${plan.completed} of ${plan.items.length} planned priorities reached their estimated focused time.`);
    addFact(facts, 'today.plan.estimated_minutes', `The priorities had ${plan.plannedMinutes} estimated focus minutes.`);
    addFact(facts, 'today.plan.actual_minutes', `${plan.actualMinutes} focused minutes are recorded against today's priorities.`);
  }
  if (sessions.count) {
    addFact(
      facts,
      'today.focus_sessions',
      `${sessions.count} focus session${sessions.count === 1 ? '' : 's'} totaling ${sessions.minutes} minutes are recorded; ${sessions.interrupted} were marked interrupted.`
    );
  }
  if (answerText(entry.blockers)) addFact(facts, 'today.blockers', `The reflection reports: ${answerText(entry.blockers).slice(0, 240)}`, 'self_report');
  if (text(entry.planBend)) addFact(facts, 'today.plan_bend', 'The reflection contains a description of where the plan bent.', 'self_report');
  if (text(entry.accomplished)) addFact(facts, 'today.accomplished', 'The reflection contains a self-reported accomplishment.', 'self_report');
  if (text(entry.tomorrowChange)) addFact(facts, 'today.tomorrow_change', 'The reflection contains a proposed change for tomorrow.', 'self_report');
  if (entry.floorHit !== null && entry.floorHit !== undefined) addFact(facts, 'today.reflection.floorHit', 'The reflection includes a yes/no floor answer.', 'self_report');
  for (const field of ['accomplished', 'blockers', 'planBend', 'tomorrowChange']) {
    if (answerText(entry[field])) addFact(facts, `today.reflection.${field}`, `The reflection reports ${field}: ${answerText(entry[field]).slice(0, 240)}`, 'self_report');
  }

  const priorPlan = prior.reduce((sum, day) => sum + planStats(day).plannedMinutes, 0);
  const priorActual = prior.reduce((sum, day) => sum + planStats(day).actualMinutes, 0);
  addFact(facts, 'history.logged_days', `${prior.length} prior logged day${prior.length === 1 ? '' : 's'} are available in the supplied history.`);
  if (prior.length >= 3) {
    addFact(facts, 'history.plan_vs_actual', `Across the prior ${prior.length} logged days, ${priorPlan} estimated focus minutes and ${priorActual} actual priority minutes are recorded.`);
  }
  for (const day of prior) {
    const stats = planStats(day);
    addFact(
      facts,
      `history.day.${day.date}`,
      `${day.date}: ${stats.items.length} priorities, ${stats.completed} completed to estimate, ${stats.actualMinutes} actual priority minutes.`,
      'history'
    );

    // Give the model a bounded window of prior reflection text so it can identify repeated
    // blockers or changes. These are explicitly labelled self-reports, not verified outcomes.
    for (const field of ['accomplished', 'blockers', 'planBend', 'tomorrowChange']) {
      const answer = answerText(day[field]);
      if (answer) {
        addFact(
          facts,
          `history.reflection.${day.date}.${field}`,
          `${day.date} prior reflection ${field}: ${answer.slice(0, 240)}`,
          'history_self_report'
        );
      }
    }

    // Previous recommendations are context only. They are never treated as new evidence or
    // instructions, and the current model still has to cite recorded facts for any new claim.
    for (const [index, recommendation] of (day.reflectionAnalysis?.recommendations ?? []).slice(0, 2).entries()) {
      if (text(recommendation?.action)) {
        addFact(
          facts,
          `history.analysis.${day.date}.${index}`,
          `${day.date} prior saved recommendation: ${text(recommendation.action).slice(0, 220)}`,
          'prior_analysis'
        );
      }
    }
  }

  return {
    facts,
    // Prior AI recommendations may be shown as context, but they are not valid evidence for a
    // new claim. User-written reflections and recorded metrics remain citeable.
    allowedRefs: new Set(facts.filter((fact) => fact.kind !== 'prior_analysis').map((fact) => fact.id)),
    historyDays: prior.length,
    historySufficient: prior.length >= 3,
    plan,
    sessions,
  };
}

export function renderReflectionEvidence(evidence = {}) {
  return (evidence.facts ?? []).map((fact) => `[${fact.id}] ${fact.text}`).join('\n') || '(no recorded plan, focus, or historical facts)';
}

const validRefs = (refs, allowedRefs) => (
  Array.isArray(refs) ? refs.filter((ref) => allowedRefs.has(ref)).slice(0, 3) : []
);

/** Remove coaching claims that do not point to a known deterministic fact. */
export function validateReflectionCoaching(output = {}, evidence = {}) {
  const allowedRefs = evidence.allowedRefs ?? new Set();
  const rejected = [];
  const items = (value, field) => (Array.isArray(value) ? value : []).flatMap((item) => {
    const refs = validRefs(item?.evidence, allowedRefs);
    if (!text(item?.text) || refs.length === 0) {
      rejected.push(field);
      return [];
    }
    return [{ text: text(item.text).slice(0, 320), evidence: refs }];
  }).slice(0, field === 'recommendations' ? 2 : 4);

  const observations = items(output.observations, 'observations');
  const interpretations = (Array.isArray(output.interpretations) ? output.interpretations : []).flatMap((item) => {
    const refs = validRefs(item?.evidence, allowedRefs);
    if (!text(item?.text) || refs.length === 0) {
      rejected.push('interpretations');
      return [];
    }
    return [{ text: text(item.text).slice(0, 320), evidence: refs, confidence: ['low', 'medium', 'high'].includes(item.confidence) ? item.confidence : 'low' }];
  }).slice(0, 3);
  const recommendations = (Array.isArray(output.recommendations) ? output.recommendations : []).flatMap((item) => {
    const refs = validRefs(item?.evidence, allowedRefs);
    if (!text(item?.action) || !text(item?.why) || refs.length === 0) {
      rejected.push('recommendations');
      return [];
    }
    return [{ action: text(item.action).slice(0, 240), why: text(item.why).slice(0, 240), evidence: refs }];
  }).slice(0, 2);

  const bottleneckRefs = validRefs(output.mainBottleneck?.evidence, allowedRefs);
  const mainBottleneck = text(output.mainBottleneck?.text) && bottleneckRefs.length
    ? { text: text(output.mainBottleneck.text).slice(0, 240), evidence: bottleneckRefs }
    : null;

  return {
    observations,
    interpretations,
    mainBottleneck,
    recommendations,
    followUpMeasure: text(output.followUpMeasure).slice(0, 240) || null,
    confidence: ['low', 'medium', 'high'].includes(output.confidence) ? output.confidence : 'low',
    rejectedCount: rejected.length,
  };
}

/** A no-provider coaching bundle. It only states facts and simple conditional actions. */
export function buildDeterministicReflectionCoaching({ evidence = {}, quality = {} } = {}) {
  const facts = evidence.facts ?? [];
  const plan = evidence.plan ?? { items: [], plannedMinutes: 0, actualMinutes: 0 };
  const sessions = evidence.sessions ?? { interrupted: 0 };
  const fact = (id) => facts.find((item) => item.id === id);
  const observations = facts.filter((item) => item.kind === 'recorded').slice(0, 3).map((item) => ({ text: item.text, evidence: [item.id] }));
  const interpretations = [];
  const recommendations = [];
  let mainBottleneck = null;

  if (plan.plannedMinutes > plan.actualMinutes && plan.items.length) {
    mainBottleneck = {
      text: 'The planned focus load was higher than the focused time recorded today.',
      evidence: ['today.plan.estimated_minutes', 'today.plan.actual_minutes'],
    };
    interpretations.push({
      text: 'The plan may have been larger than the available focused time; the recorded data cannot identify whether task difficulty or distraction was the main cause.',
      evidence: ['today.plan.estimated_minutes', 'today.plan.actual_minutes'],
      confidence: 'medium',
    });
    recommendations.push({
      action: 'Choose two must-do priorities tomorrow and mark the rest optional.',
      why: 'This directly tests whether a smaller plan improves completion.',
      evidence: ['today.plan.count', 'today.plan.estimated_minutes'],
    });
  } else if (sessions.interrupted > 0) {
    mainBottleneck = { text: 'Interruptions are the clearest recorded friction today.', evidence: ['today.focus_sessions'] };
    recommendations.push({
      action: 'Start one 25-minute focus block with the interruption source out of reach.',
      why: 'Compare the next block with today’s interrupted sessions.',
      evidence: ['today.focus_sessions'],
    });
  } else if (fact('today.blockers')) {
    mainBottleneck = { text: 'The reflection names a blocker, but the recorded data does not establish its cause.', evidence: ['today.blockers'] };
    recommendations.push({
      action: 'Record the first concrete trigger when the blocker appears tomorrow.',
      why: 'A trigger is more actionable than a general label such as “wasted time”.',
      evidence: ['today.blockers'],
    });
  }

  if (quality.vagueCount > 0 && recommendations.length < 2) {
    const vagueField = (quality.fields ?? []).find((field) => field.isVague);
    if (vagueField) {
      const ref = `today.reflection.${vagueField.fieldId}`;
      // The reflection field is not always a fact in the list; add it only when present.
      if (evidence.allowedRefs?.has(ref)) {
        recommendations.push({
          action: 'Answer the vague reflection field with one observable detail tomorrow.',
          why: 'Specific details make the next analysis more useful.',
          evidence: [ref],
        });
      }
    }
  }

  return {
    observations,
    interpretations,
    mainBottleneck,
    recommendations,
    followUpMeasure: recommendations.length ? 'Record planned minutes, actual focus minutes, and the first reason a priority slips.' : 'Record one concrete outcome and one reason for any unfinished priority.',
    confidence: evidence.historySufficient ? 'medium' : 'low',
  };
}
