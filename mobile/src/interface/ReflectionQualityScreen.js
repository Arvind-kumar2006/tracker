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
import { colors, typography, styles, spacing, radius } from './theme.js';

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
    return (
      <View style={styles.screen}>
        <Text style={[styles.content, typography.body]}>Checking quality…</Text>
      </View>
    );
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
      </View>

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
        </View>
      ))}

      {report.followUpQuestions.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Follow-up questions</Text>
          {report.followUpQuestions.map((fq, i) => (
            <View key={i} style={[styles.card, { marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primary }]}>
              <Text style={[typography.small]}>{fq.question}</Text>
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
