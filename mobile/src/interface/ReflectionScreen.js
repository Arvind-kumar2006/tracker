/**
 * ReflectionScreen — a five-question guided daily reflection.
 *
 * Each question gets its own step, but the form is saved as a partial journal entry whenever
 * the user chooses Save progress. That keeps an interrupted reflection useful instead of making
 * the user reach question five before anything is persisted.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { container } from '../shared/container.js';
import { REFLECTION_QUESTIONS, emptyReflectionForm, entryToForm, formToPayload } from '../domain/reflection.js';
import { formatDate } from '../domain/index.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, EmptyState, LoadingState } from './components.js';

const QUESTION_LABELS = {
  floorHit: 'Did',
  accomplished: 'Win',
  blockers: 'Avoids',
  planBend: 'Roadblock',
  tomorrowChange: 'One thing',
};

const today = () => new Date().toISOString().slice(0, 10);

export function ReflectionScreen({ route, navigation }) {
  const date = route.params?.date ?? today();
  const suggestedField = route.params?.suggestionField;
  const suggestedText = route.params?.suggestionText;
  const focusHint = route.params?.focusHint;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyReflectionForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncWarning, setSyncWarning] = useState(null);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [planContext, setPlanContext] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadError(null);
    setSaved(false);
    const res = await container.loadDay(date);
    setLoading(false);
    if (!res.ok && res.error.status !== 404) {
      setLoadError(res.error.message);
      return;
    }
    if (!res.ok) {
      setForm(emptyReflectionForm());
      setPlanContext([]);
      return;
    }
    const loaded = entryToForm(res.value);
    if (suggestedField && suggestedText && Object.prototype.hasOwnProperty.call(loaded, suggestedField)) loaded[suggestedField] = suggestedText;
    setForm(loaded);
    setPlanContext((res.value.plan?.items ?? []).map((item) => {
      const focused = Number(item.actualMinutes ?? 0);
      return item.text ? `${item.text}${focused > 0 ? ` · ${focused}m focused` : ''}` : '';
    }).filter(Boolean));
  }, [date, suggestedField, suggestedText]);

  useEffect(() => { load(); }, [load]);

  const question = REFLECTION_QUESTIONS[step];
  const isLast = step === REFLECTION_QUESTIONS.length - 1;

  const updateField = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaved(false);
    setSyncWarning(null);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSyncWarning(null);
    const res = await container.saveDailyEntry({ date, ...formToPayload(form) });
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return false;
    }
    setSaved(true);
    if (res.value?.sheets && !res.value.sheets.synced && !res.value.sheets.skipped) setSyncWarning(`Saved, but Google Sheets sync failed: ${res.value.sheets.error}`);
    return true;
  }, [form, date]);

  const next = useCallback(() => {
    if (step < REFLECTION_QUESTIONS.length - 1) setStep((current) => current + 1);
  }, [step]);

  const back = useCallback(() => {
    if (step > 0) setStep((current) => current - 1);
  }, [step]);

  const checkQuality = useCallback(() => navigation.navigate('ReflectionQuality', { date }), [navigation, date]);

  const renderBooleanReason = () => (
    <View>
      <Text style={[typography.small, { marginBottom: spacing.xs }]}>Did you hit your floor?</Text>
      <View style={[styles.wrap, { marginBottom: spacing.md }]}>
        {[true, false].map((value) => (
          <Pressable
            key={String(value)}
            accessible
            accessibilityRole="button"
            accessibilityLabel={value ? 'Floor hit yes' : 'Floor hit no'}
            accessibilityState={{ selected: form.floorHit === value }}
            onPress={() => updateField('floorHit', form.floorHit === value ? null : value)}
            style={[styles.chip, { paddingHorizontal: spacing.lg }, form.floorHit === value && { borderColor: colors.primary, backgroundColor: colors.primaryTint }]}
          >
            <Text style={typography.small}>{value ? 'Yes' : 'No'}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessible
        accessibilityLabel="Floor hit explanation"
        value={form.floorHitReason}
        onChangeText={(value) => updateField('floorHitReason', value)}
        placeholder={question.placeholder}
        placeholderTextColor={colors.textMuted}
        multiline
        style={[styles.input, { minHeight: 88, textAlignVertical: 'top', marginBottom: spacing.md }]}
      />
    </View>
  );

  const renderText = () => (
    <TextInput
      accessible
      accessibilityLabel={question.question}
      value={form[question.fields[0]]}
      onChangeText={(value) => updateField(question.fields[0], value)}
      placeholder={question.placeholder}
      placeholderTextColor={colors.textMuted}
      multiline
      style={[styles.input, { minHeight: 126, textAlignVertical: 'top', marginBottom: spacing.md }]}
    />
  );

  if (loading) return <LoadingState label="Loading your reflection…" />;
  if (loadError) return <EmptyState title="Reflection unavailable" message={loadError} action="Retry" onAction={load} />;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Text style={typography.h1}>Reflect</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>{formatDate(date)} · one honest step at a time</Text>
          </View>
          <Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>{step + 1}/{REFLECTION_QUESTIONS.length}</Text>
        </View>

        <View style={[styles.progressTrack, { marginTop: spacing.lg, marginBottom: spacing.lg }]} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: REFLECTION_QUESTIONS.length, now: step + 1 }}>
          <View style={[styles.progressFill, { width: `${((step + 1) / REFLECTION_QUESTIONS.length) * 100}%` }]} />
        </View>

        {planContext.length ? (
          <View style={[styles.card, { marginBottom: spacing.md }]}>
            <Text style={typography.tiny}>TODAY'S PLAN</Text>
            {planContext.map((item, index) => <Text key={`${item}-${index}`} style={[typography.small, { marginTop: spacing.xs }]}>• {item}</Text>)}
          </View>
        ) : null}

        {error ? <Banner tone="negative">{error}</Banner> : null}

        <View style={[styles.card, { marginBottom: spacing.lg }]}>
          <Text style={typography.tiny}>{QUESTION_LABELS[question.id].toUpperCase()}</Text>
          <Text style={[typography.h2, { marginTop: spacing.xs }]}>{question.question}</Text>
          <Text style={[typography.small, { marginTop: spacing.xs, marginBottom: spacing.md }]}>{question.description}</Text>
          {focusHint ? <Banner tone="warning">Follow-up: {focusHint}</Banner> : null}
          {question.type === 'boolean-reason' ? renderBooleanReason() : renderText()}
          <Text style={typography.tiny}>{question.hint}</Text>
        </View>

        <Button label={saved ? 'Saved' : 'Save progress'} variant="secondary" onPress={save} loading={saving} disabled={saving} />

        <View style={[styles.row, { marginTop: spacing.sm }]}>
          {step > 0 ? <Button label="Back" variant="ghost" onPress={back} style={{ flex: 1, marginRight: spacing.sm }} /> : <View style={{ flex: 1, marginRight: spacing.sm }} />}
          {!isLast ? <Button label="Next question" onPress={next} style={{ flex: 1 }} /> : <Button label="Save reflection" onPress={save} loading={saving} disabled={saving} style={{ flex: 1 }} />}
        </View>

        {saved ? (
          <View style={{ marginTop: spacing.lg }}>
            <Banner tone="positive">Reflection saved. You can leave now and continue later.</Banner>
            {syncWarning ? <Banner tone="warning">{syncWarning}</Banner> : null}
            {isLast ? <Button label="Check quality" variant="secondary" onPress={checkQuality} /> : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
