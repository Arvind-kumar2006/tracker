import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { REFLECTION_QUESTIONS, emptyReflectionForm, entryToForm, formToPayload } from '../domain/reflection.js';
import { formatDate } from '../domain/index.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, EmptyState, LoadingState } from './components.js';

const today = () => new Date().toISOString().slice(0, 10);

const shiftDate = (date, amount) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

const TextAnswer = ({ value, onChangeText, placeholder, accessibilityLabel }) => (
  <TextInput
    accessible
    accessibilityLabel={accessibilityLabel}
    value={value}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={colors.textMuted}
    multiline
    style={[styles.input, { minHeight: 74, textAlignVertical: 'top', marginTop: spacing.sm }]}
  />
);

export function SimpleReflectionScreen({ route, navigation }) {
  const date = route.params?.date ?? today();
  const [form, setForm] = useState(emptyReflectionForm());
  const [planContext, setPlanContext] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncWarning, setSyncWarning] = useState(null);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

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
    setForm(entryToForm(res.value));
    setPlanContext((res.value.plan?.items ?? []).map((item) => {
      const minutes = Number(item.actualMinutes ?? 0);
      return item.text ? `${item.text}${minutes > 0 ? ` · ${minutes}m focused` : ''}` : '';
    }).filter(Boolean));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const updateField = useCallback((field, value) => {
    setSaved(false);
    setSyncWarning(null);
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSyncWarning(null);
    const res = await container.saveDailyEntry({ date, ...formToPayload(form) });
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setSaved(true);
    if (res.value?.sheets && !res.value.sheets.synced && !res.value.sheets.skipped) {
      setSyncWarning(`Saved here, but the sheet sync failed: ${res.value.sheets.error}`);
    }
  }, [date, form]);

  if (loading) return <LoadingState label="Loading your reflection…" />;
  if (loadError) return <EmptyState title="Reflection unavailable" message={loadError} action="Retry" onAction={load} />;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Text style={typography.h1}>Reflect</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>Five lines · five minutes · {formatDate(date)}</Text>
          </View>
          <View style={styles.row}>
            <Pressable accessible accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => navigation.navigate('Reflection', { date: shiftDate(date, -1) })} style={styles.chip}>
              <Text style={[typography.h2, { color: colors.primarySoft }]}>‹</Text>
            </Pressable>
            <Pressable accessible accessibilityRole="button" accessibilityLabel="Next day" onPress={() => navigation.navigate('Reflection', { date: shiftDate(date, 1) })} style={[styles.chip, { marginRight: 0 }]}>
              <Text style={[typography.h2, { color: colors.primarySoft }]}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, { marginTop: spacing.lg, borderColor: colors.primary + '66' }]}>
          <Text style={typography.tiny}>NO SELF-JUDGEMENT</Text>
          <Text style={[typography.h2, { marginTop: spacing.xs }]}>Record facts, not a verdict.</Text>
          <Text style={[typography.small, { marginTop: spacing.xs }]}>Short answers are enough. “Nothing” is a valid Win.</Text>
        </View>

        {planContext.length ? (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={typography.tiny}>TODAY'S PLAN</Text>
            {planContext.map((item, index) => <Text key={`${item}-${index}`} style={[typography.small, { marginTop: spacing.xs }]}>• {item}</Text>)}
          </View>
        ) : null}

        {error ? <Banner tone="negative">{error}</Banner> : null}

        {REFLECTION_QUESTIONS.map((question) => (
          <View key={question.id} style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={typography.tiny}>{question.shortLabel.toUpperCase()}</Text>
            <Text style={[typography.h3, { marginTop: spacing.xs }]}>{question.question}</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>{question.hint}</Text>

            {question.id === 'floorHit' ? (
              <View>
                <View style={[styles.wrap, { marginTop: spacing.md }]}>
                  {[true, false].map((value) => (
                    <Pressable
                      key={String(value)}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={value ? 'Did yes' : 'Did no'}
                      accessibilityState={{ selected: form.floorHit === value }}
                      onPress={() => updateField('floorHit', form.floorHit === value ? null : value)}
                      style={[styles.chip, form.floorHit === value && { borderColor: colors.primary, backgroundColor: colors.primaryTint }]}
                    >
                      <Text style={typography.small}>{value ? 'Yes' : 'No'}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextAnswer
                  value={form.floorHitReason}
                  onChangeText={(value) => updateField('floorHitReason', value)}
                  placeholder="What did you actually do?"
                  accessibilityLabel="Did explanation"
                />
              </View>
            ) : (
              <TextAnswer
                value={form[question.fields[0]]}
                onChangeText={(value) => updateField(question.fields[0], value)}
                placeholder={question.placeholder}
                accessibilityLabel={question.question}
              />
            )}
          </View>
        ))}

        <Button label="Save reflection" onPress={save} loading={saving} disabled={saving} style={{ marginTop: spacing.lg }} />
        {saved ? (
          <View style={{ marginTop: spacing.md }}>
            <Banner tone="positive">Reflection saved. You are done for today.</Banner>
            {syncWarning ? <Banner tone="warning">{syncWarning}</Banner> : null}
          </View>
        ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
