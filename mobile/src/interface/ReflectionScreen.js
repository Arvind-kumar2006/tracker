/**
 * ReflectionScreen — the 5-question guided daily reflection.
 *
 * Replaces the old flat DailyLogScreen. One question per screen with
 * a "Next" button forces the user to think about each answer
 * independently, rather than rushing through a flat form.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { container } from '../shared/container.js';
import { REFLECTION_QUESTIONS, emptyReflectionForm, formToPayload } from '../domain/reflection.js';
import { formatDate } from '../domain/index.js';
import { colors, typography, styles, spacing, radius } from './theme.js';

const QUESTION_LABELS = {
  floorHit: 'Did',
  accomplished: 'Win',
  blockers: 'Avoids',
  planBend: 'Roadblock',
  tomorrowChange: 'One thing',
};

export function ReflectionScreen({ route, navigation }) {
  const date = route.params?.date ?? new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyReflectionForm());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const question = REFLECTION_QUESTIONS[step];
  const isLast = step === REFLECTION_QUESTIONS.length - 1;

  const updateField = useCallback((field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }, []);

  const next = useCallback(() => {
    if (step < REFLECTION_QUESTIONS.length - 1) {
      setStep((s) => s + 1);
    }
  }, [step]);

  const back = useCallback(() => {
    if (step > 0) {
      setStep((s) => s - 1);
    }
  }, [step]);

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    const payload = formToPayload(form);
    payload.date = date;
    const res = await container.saveDailyEntry(payload);
    setSaving(false);
    if (res.ok) {
      setSaved(true);
    } else {
      setError(res.error.message);
    }
  }, [form, date]);

  const checkQuality = useCallback(() => {
    navigation.navigate('ReflectionQuality', { date });
  }, [navigation, date]);

  const renderBooleanReason = () => (
    <View>
      <Text style={[typography.small, { marginBottom: spacing.xs }]}>Did you hit your floor?</Text>
      <View style={[styles.wrap, { marginBottom: spacing.md }]}>
        {[true, false].map((val) => (
          <Pressable
            key={String(val)}
            onPress={() => updateField('floorHit', form.floorHit === val ? null : val)}
            style={[
              styles.chip,
              { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
              form.floorHit === val && { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
            ]}
          >
            <Text style={typography.small}>{val ? 'Yes' : 'No'}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={form.floorHitReason}
        onChangeText={(v) => updateField('floorHitReason', v)}
        placeholder={question.placeholder}
        placeholderTextColor={colors.textMuted}
        multiline
        style={{
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          color: colors.text,
          padding: spacing.md,
          marginBottom: spacing.md,
          minHeight: 80,
          textAlignVertical: 'top',
          fontSize: 14,
        }}
      />
    </View>
  );

  const renderText = () => (
    <TextInput
      value={form[question.fields[0]]}
      onChangeText={(v) => updateField(question.fields[0], v)}
      placeholder={question.placeholder}
      placeholderTextColor={colors.textMuted}
      multiline
      style={{
        backgroundColor: colors.surfaceAlt,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.text,
        padding: spacing.md,
        marginBottom: spacing.md,
        minHeight: 120,
        textAlignVertical: 'top',
        fontSize: 14,
      }}
    />
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>{formatDate(date)}</Text>
      <Text style={[typography.small, { marginBottom: spacing.lg }]}>
        {step + 1} of {REFLECTION_QUESTIONS.length} — {QUESTION_LABELS[question.id]}
      </Text>

      {error ? (
        <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: colors.negative, marginBottom: spacing.md }]}>
          <Text style={[typography.small, { color: colors.negative }]}>{error}</Text>
        </View>
      ) : null}

      <View style={[styles.card, { marginBottom: spacing.lg }]}>
        <Text style={typography.h3}>{question.question}</Text>
        <Text style={[typography.small, { marginTop: 4, marginBottom: spacing.md, color: colors.textMuted }]}>
          {question.description}
        </Text>

        {question.type === 'boolean-reason' ? renderBooleanReason() : renderText()}

        <Text style={[typography.tiny, { color: colors.textMuted }]}>{question.hint}</Text>
      </View>

      <View style={[styles.row, { marginTop: spacing.md }]}>
        {step > 0 ? (
          <Pressable
            onPress={back}
            style={[styles.button, { flex: 1, marginRight: spacing.sm, backgroundColor: colors.surfaceAlt }]}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>Back</Text>
          </Pressable>
        ) : null}

        {!isLast ? (
          <Pressable
            onPress={next}
            style={[styles.button, { flex: 1, marginLeft: step > 0 ? spacing.sm : 0 }]}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Next</Text>
          </Pressable>
        ) : null}
      </View>

      {isLast ? (
        <View style={{ marginTop: spacing.md }}>
          <Pressable
            onPress={submit}
            disabled={saving}
            style={[styles.button, saving && styles.buttonDisabled]}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save reflection'}
            </Text>
          </Pressable>

          {saved ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.small, { color: colors.positive, marginBottom: spacing.sm }]}>
                Reflection saved.
              </Text>
              <Pressable onPress={checkQuality} style={[styles.button, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Check quality</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
