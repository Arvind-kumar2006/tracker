/**
 * ReflectionQualityScreen — post-save AI feedback on answer quality.
 *
 * Shows the AI's per-field scores, flags vague answers, and suggests
 * follow-up questions. The user can see which answers are too generic
 * to be useful for pattern analysis.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { container } from '../shared/container.js';
import { buildQualityViewModel } from '../domain/reflection.js';
import { formatDate } from '../domain/index.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, LoadingState, StatusPill } from './components.js';

const FIELD_LABELS = {
  floorHit: 'Did (floor hit)',
  accomplished: 'Win (built/finished)',
  blockers: 'Avoids (what avoided)',
  planBend: 'Roadblock (plan bend)',
  tomorrowChange: 'One thing (tomorrow)',
};

const TONE_COLORS = {
  positive: colors.positive,
  warning: colors.warning,
  negative: colors.negative,
};

export function ReflectionQualityScreen({ route, navigation }) {
  const date = route.params?.date ?? new Date().toISOString().slice(0, 10);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState([]);
  const [dismissedFollowUps, setDismissedFollowUps] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await container.getReflectionQuality(date);
    if (!res.ok) {
      setError(res.error.message);
      setLoading(false);
      return;
    }
    setReport(buildQualityViewModel(res.value));
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <LoadingState label="Checking your reflection…" />;
  }

  if (error) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={typography.h1}>Quality check</Text>
        <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: colors.negative }]}>
          <Text style={[typography.small, { color: colors.negative }]}>{error}</Text>
        </View>
        <Pressable onPress={() => navigation.goBack()} style={[styles.button, { marginTop: spacing.md }]}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Back</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (!report) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={typography.h1}>Quality check</Text>
        <Text style={[typography.small]}>No report available.</Text>
      </ScrollView>
    );
  }

  const toneColor = TONE_COLORS[report.tone] ?? colors.textMuted;
  const statusLabel = report.status === 'needs_clarification'
    ? 'NEEDS CLARIFICATION'
    : report.status === 'fallback'
      ? 'DETERMINISTIC FALLBACK'
      : 'ANALYSIS COMPLETE';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Quality check</Text>
      <Text style={[typography.small, { marginBottom: spacing.lg }]}>
        {formatDate(date)} — {report.isComplete ? 'All questions answered' : 'Some questions unanswered'}
      </Text>

      <View style={[styles.card, { marginBottom: spacing.lg, borderLeftWidth: 4, borderLeftColor: toneColor }]}>
        <Text style={[typography.h1, { color: toneColor }]}>
          {report.overallScore}/10
        </Text>
        <Text style={[typography.small, { marginTop: 4 }]}>
          {report.vagueCount === 0
            ? 'All answers are specific and useful.'
            : `${report.vagueCount} answer(s) could be more specific.`}
        </Text>
        {report.summary ? (
          <Text style={[typography.small, { marginTop: spacing.sm, color: colors.textMuted }]}>
            {report.summary}
          </Text>
        ) : null}
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <StatusPill label={statusLabel} tone={report.status === 'fallback' ? 'warning' : report.status === 'needs_clarification' ? 'warning' : 'positive'} />
          <Text style={[typography.tiny, { marginLeft: spacing.sm }]}>confidence: {report.confidence}</Text>
        </View>
      </View>

      {report.qualitySource === 'mechanical' ? <Banner tone="warning">AI review was unavailable. These facts and suggestions were generated deterministically; you can retry later without resaving your reflection.</Banner> : null}

      {report.observations.length ? (
        <View style={styles.card}>
          <Text style={typography.h3}>Observed facts</Text>
          {report.observations.map((item, index) => (
            <View key={`observation-${index}`} style={{ marginTop: spacing.sm }}>
              <Text style={typography.body}>• {item.text}</Text>
              <Text style={typography.tiny}>Evidence linked</Text>
            </View>
          ))}
        </View>
      ) : null}

      {report.interpretations.length ? (
        <View style={styles.card}>
          <Text style={typography.h3}>What may explain it</Text>
          <Text style={[typography.tiny, { marginTop: spacing.xs }]}>These are hypotheses, not proven causes.</Text>
          {report.interpretations.map((item, index) => (
            <View key={`interpretation-${index}`} style={{ marginTop: spacing.sm }}>
              <Text style={typography.body}>• {item.text}</Text>
              <Text style={typography.tiny}>Confidence: {item.confidence}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {report.mainBottleneck ? (
        <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: colors.warning }]}>
          <Text style={typography.tiny}>MAIN BOTTLENECK</Text>
          <Text style={[typography.body, { marginTop: spacing.xs }]}>{report.mainBottleneck.text}</Text>
        </View>
      ) : null}

      {report.recommendations.length ? (
        <View style={styles.card}>
          <Text style={typography.h3}>For tomorrow</Text>
          {report.recommendations.map((item, index) => (
            <View key={`recommendation-${index}`} style={{ marginTop: spacing.md }}>
              <Text style={typography.body}>• {item.action}</Text>
              <Text style={[typography.small, { marginTop: 2 }]}>{item.why}</Text>
            </View>
          ))}
          {report.followUpMeasure ? <Banner tone="neutral">Track this: {report.followUpMeasure}</Banner> : null}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Per question</Text>
      {report.fields.map((f) => (
        <View key={f.fieldId} style={[styles.card, { marginBottom: spacing.sm }]}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={typography.small}>
              {FIELD_LABELS[f.fieldId] ?? f.fieldId}
            </Text>
            <Text style={[typography.small, { color: TONE_COLORS[f.scoreTone] ?? colors.textMuted }]}>
              {f.score}/10
            </Text>
          </View>
          {f.isVague ? (
            <Text style={[typography.tiny, { color: colors.warning, marginTop: 4 }]}>
              {f.reason}
            </Text>
          ) : (
            <Text style={[typography.tiny, { color: colors.positive, marginTop: 4 }]}>
              {f.reason}
            </Text>
          )}
          {f.suggestion && !dismissedSuggestions.includes(f.fieldId) ? (
            <View style={{ marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={[typography.tiny, { color: colors.primary }]}>OPTIONAL SUGGESTION</Text>
              <Text style={[typography.small, { marginTop: spacing.xs }]}>{f.suggestion}</Text>
              <View style={[styles.row, { marginTop: spacing.sm }]}>
                <Pressable
                  onPress={() => navigation.navigate('Reflection', { date, suggestionField: f.fieldId, focusHint: f.suggestion })}
                  style={[styles.button, { flex: 1, marginRight: spacing.sm, paddingVertical: spacing.sm }]}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Answer ${FIELD_LABELS[f.fieldId] ?? f.fieldId}`}
                >
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>Use to edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDismissedSuggestions((current) => [...current, f.fieldId])}
                  style={[styles.button, styles.buttonSecondary, { flex: 1, paddingVertical: spacing.sm }]}
                >
                  <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 12 }}>Keep original</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ))}

      {report.followUpQuestions.filter((fq) => !dismissedFollowUps.includes(fq.fieldId)).length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Follow-up questions</Text>
          {report.followUpQuestions.filter((fq) => !dismissedFollowUps.includes(fq.fieldId)).map((fq, i) => (
            <View key={i} style={[styles.card, { marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primary }]}>
              <Text style={[typography.small]}>{fq.question}</Text>
              {fq.choices?.length ? (
                <View style={[styles.wrap, { marginTop: spacing.sm }]}>
                  {fq.choices.map((choice) => (
                    <Pressable key={choice} accessible accessibilityRole="button" onPress={() => navigation.navigate('Reflection', { date, suggestionField: fq.fieldId, focusHint: `${fq.question} Possible angle: ${choice}` })} style={styles.chip}>
                      <Text style={typography.tiny}>{choice}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={[styles.row, { marginTop: spacing.sm }]}>
                <Button label="Answer this" variant="secondary" onPress={() => navigation.navigate('Reflection', { date, suggestionField: fq.fieldId, focusHint: fq.question })} style={{ flex: 1, marginRight: spacing.sm }} />
                <Button label="Skip" variant="ghost" onPress={() => setDismissedFollowUps((current) => [...current, fq.fieldId])} />
              </View>
            </View>
          ))}
        </>
      ) : null}

      <Pressable
        onPress={() => navigation.navigate('Reflection', { date })}
        style={[styles.button, { marginTop: spacing.lg }]}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>Edit reflection</Text>
      </Pressable>
    </ScrollView>
  );
}
