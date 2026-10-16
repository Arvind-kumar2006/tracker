import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { container } from '../shared/container.js';
import { formatDate } from '../domain/index.js';
import {
  MAX_DAILY_PRIORITIES,
  PLAN_PRIORITIES,
  emptyDailyPlan,
  emptyTask,
  planToForm,
  planToPayload,
  reviewPlan,
} from '../domain/dailyPlan.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, LoadingState, StatusPill } from './components.js';

const Field = ({ value, onChangeText, placeholder, keyboardType = 'default', multiline = false, accessibilityLabel }) => (
  <TextInput
    accessible
    accessibilityLabel={accessibilityLabel ?? placeholder}
    value={String(value ?? '')}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={colors.textMuted}
    keyboardType={keyboardType}
    multiline={multiline}
    style={[styles.input, { marginTop: spacing.xs, minHeight: multiline ? 78 : 48, textAlignVertical: multiline ? 'top' : 'center' }]}
  />
);

const shiftDate = (date, amount) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

export function DailyPlanScreen({ route, navigation }) {
  const date = route.params?.date ?? new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(emptyDailyPlan());
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [serverWarnings, setServerWarnings] = useState([]);
  const [aiReview, setAiReview] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [carryBusy, setCarryBusy] = useState(false);
  const [carryMessage, setCarryMessage] = useState(null);

  const localReview = useMemo(() => reviewPlan(form), [form]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await container.loadDay(date);
    setLoading(false);
    if (res.ok) {
      setForm(planToForm(res.value.plan));
      return;
    }
    if (res.error.status === 404) {
      setForm(emptyDailyPlan());
      return;
    }
    setError(res.error.message);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const update = useCallback((key, value) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const updateItem = useCallback((index, key, value) => {
    setSaved(false);
    setForm((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  }, []);

  const addItem = useCallback(() => {
    setForm((current) => (
      current.items.length >= MAX_DAILY_PRIORITIES
        ? current
        : { ...current, items: [...current.items, emptyTask(current.items.length)] }
    ));
  }, []);

  const removeItem = useCallback((index) => {
    Alert.alert('Remove priority?', 'This only removes it from the unsaved plan.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setForm((current) => ({
          ...current,
          items: current.items.filter((_, i) => i !== index),
        })),
      },
    ]);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setServerWarnings([]);
    const res = await container.saveDailyPlan(date, planToPayload(form));
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setForm(planToForm(res.value.plan));
    setServerWarnings(res.value.review?.warnings ?? []);
    setSaved(true);
  }, [date, form]);

  const checkWithAi = useCallback(async () => {
    setReviewBusy(true);
    setError(null);
    const res = await container.checkDailyPlan(date, planToPayload(form));
    setReviewBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setAiReview(res.value);
  }, [date, form]);

  const generateWithAi = useCallback(async () => {
    setGenerateBusy(true);
    setError(null);
    const res = await container.generateDailyPlan(date, {
      goal,
      availableMinutes: form.availableMinutes,
      minimumMinutes: form.minimumMinutes,
      idealMinutes: form.idealMinutes,
    });
    setGenerateBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setForm(planToForm(res.value.plan));
    setAiReview({
      ...res.value.review,
      qualitySource: res.value.qualitySource,
      summary: res.value.summary,
      suggestions: [],
    });
    setSaved(false);
  }, [date, form.availableMinutes, form.idealMinutes, form.minimumMinutes, goal]);

  const unfinished = form.items.filter((item) => (
    item.text.trim() && item.status !== 'DONE' && Number(item.actualMinutes ?? 0) < Number(item.estimatedMinutes ?? 0)
  ));

  const carryForward = useCallback(async () => {
    setCarryBusy(true);
    setError(null);
    setCarryMessage(null);
    const targetDate = shiftDate(date, 1);
    const res = await container.carryForwardPlan(date, targetDate);
    setCarryBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setCarryMessage(`Moved ${res.value.movedItems.length} unfinished priority(s) to ${targetDate}.`);
    navigation.navigate('DailyPlan', { date: targetDate });
  }, [date, navigation]);

  if (loading) {
    return <LoadingState label="Loading your plan…" />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text style={typography.h1}>Plan your day</Text>
          <Text style={[typography.small, { marginTop: spacing.xs }]}>{formatDate(date)} · up to three priorities</Text>
        </View>
        <View style={styles.row}>
          <Pressable accessible accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => navigation.navigate('DailyPlan', { date: shiftDate(date, -1) })} hitSlop={8} style={[styles.chip, { marginBottom: 0 }]}><Text style={[typography.h2, { color: colors.primarySoft }]}>‹</Text></Pressable>
          <Pressable accessible accessibilityRole="button" accessibilityLabel="Next day" onPress={() => navigation.navigate('DailyPlan', { date: shiftDate(date, 1) })} hitSlop={8} style={[styles.chip, { marginBottom: 0, marginRight: 0 }]}><Text style={[typography.h2, { color: colors.primarySoft }]}>›</Text></Pressable>
        </View>
      </View>

      {error ? <Banner tone="negative">{error}</Banner> : null}
      {saved ? <Banner tone="positive">Plan saved. It is now available to reflection and analysis.</Banner> : null}
      {carryMessage ? <Banner tone="positive">{carryMessage}</Banner> : null}

      <View style={[styles.card, { borderColor: colors.primary + '66' }]}>
        <Text style={typography.h3}>Optional AI draft</Text>
        <Text style={[typography.tiny, { marginTop: spacing.xs }]}>Describe what you want to accomplish. The draft is editable and is not saved until you choose Save.</Text>
        <Field
          value={goal}
          onChangeText={setGoal}
          placeholder="e.g. prepare for a backend interview"
          multiline
        />
        <Button label="Generate 3-priority draft" onPress={generateWithAi} loading={generateBusy} disabled={generateBusy || !goal.trim()} style={{ marginTop: spacing.md }} />
      </View>

      {form.items.map((item, index) => (
        <View key={item.id} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: item.priority === 'HIGH' ? colors.negative : item.priority === 'LOW' ? colors.textMuted : colors.primarySoft }]}>
          <View style={styles.rowBetween}>
            <Text style={typography.h3}>Priority {index + 1}</Text>
            <StatusPill label={item.actualMinutes > 0 ? `${item.actualMinutes}m focused` : item.priority} tone={item.actualMinutes > 0 ? 'positive' : item.priority === 'HIGH' ? 'warning' : 'neutral'} />
            {form.items.length > 1 ? (
              <Pressable accessible accessibilityRole="button" accessibilityLabel={`Remove priority ${index + 1}`} onPress={() => removeItem(index)} hitSlop={8}>
                <Text style={[typography.small, { color: colors.negative }]}>Remove</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={[typography.tiny, { marginTop: spacing.md }]}>TASK</Text>
          <Field
            value={item.text}
            onChangeText={(value) => updateItem(index, 'text', value)}
            placeholder="e.g. Solve 10 array problems"
            accessibilityLabel={`Priority ${index + 1} task`}
          />
          {localReview.warnings.filter((warning) => warning.itemId === item.id && warning.code === 'VAGUE_TASK').map((warning) => <Text key={warning.code} style={[typography.tiny, { color: colors.warning, marginTop: spacing.xs }]}>{warning.message} Try adding a quantity, artifact, or checkpoint.</Text>)}

          <Text style={[typography.tiny, { marginTop: spacing.md }]}>OUTCOME</Text>
          <Field
            value={item.outcome}
            onChangeText={(value) => updateItem(index, 'outcome', value)}
            placeholder="e.g. working solutions committed"
            accessibilityLabel={`Priority ${index + 1} outcome`}
          />
          {localReview.warnings.filter((warning) => warning.itemId === item.id && warning.code === 'MISSING_OUTCOME').map((warning) => <Text key={warning.code} style={[typography.tiny, { color: colors.warning, marginTop: spacing.xs }]}>{warning.message}</Text>)}

          <Text style={[typography.tiny, { marginTop: spacing.md }]}>ESTIMATED FOCUS (MINUTES)</Text>
          <Field
            value={item.estimatedMinutes}
            onChangeText={(value) => updateItem(index, 'estimatedMinutes', value.replace(/\D/g, ''))}
            keyboardType="number-pad"
            placeholder="30"
            accessibilityLabel={`Priority ${index + 1} estimated minutes`}
          />
          {Number(item.actualMinutes) > 0 ? (
            <Text style={[typography.tiny, { marginTop: spacing.xs, color: colors.positive }]}>Focused so far: {item.actualMinutes} minutes</Text>
          ) : null}

          <Text style={[typography.tiny, { marginTop: spacing.md, marginBottom: spacing.xs }]}>PRIORITY</Text>
          <View style={styles.wrap}>
            {PLAN_PRIORITIES.map((value) => (
              <Pressable
                key={value}
                onPress={() => updateItem(index, 'priority', value)}
                style={[styles.chip, item.priority === value && { borderColor: colors.primary, backgroundColor: colors.primary + '20' }]}
              >
                <Text style={typography.small}>{value}</Text>
              </Pressable>
            ))}
          </View>
          {saved ? (
            <Pressable
              style={[styles.button, styles.buttonSecondary, { marginTop: spacing.md }]}
              onPress={() => navigation.navigate('FocusSession', {
                date,
                itemId: item.id,
                itemText: item.text,
                estimatedMinutes: item.estimatedMinutes,
              })}
            >
              <Text style={styles.buttonSecondaryText}>Start focus session</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {form.items.length < MAX_DAILY_PRIORITIES ? (
        <Pressable style={[styles.button, styles.buttonSecondary, { marginBottom: spacing.md }]} onPress={addItem}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Add another priority</Text>
        </Pressable>
      ) : null}

      <View style={styles.card}>
        <Text style={typography.h3}>Targets and realistic time</Text>
        <Text style={[typography.tiny, { marginTop: spacing.xs }]}>Use minutes. Breaks and buffer are part of the plan.</Text>
        <Text style={[typography.tiny, { marginTop: spacing.md }]}>MINIMUM TARGET</Text>
        <Field value={form.minimumMinutes} onChangeText={(value) => update('minimumMinutes', value.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="30" />
        <Text style={[typography.tiny, { marginTop: spacing.md }]}>IDEAL TARGET</Text>
        <Field value={form.idealMinutes} onChangeText={(value) => update('idealMinutes', value.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="120" />
        <Text style={[typography.tiny, { marginTop: spacing.md }]}>BREAK MINUTES</Text>
        <Field value={form.breakMinutes} onChangeText={(value) => update('breakMinutes', value.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="15" />
        <Text style={[typography.tiny, { marginTop: spacing.md }]}>BUFFER MINUTES</Text>
        <Field value={form.bufferMinutes} onChangeText={(value) => update('bufferMinutes', value.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="15" />
        <Text style={[typography.tiny, { marginTop: spacing.md }]}>AVAILABLE MINUTES (OPTIONAL)</Text>
        <Field value={form.availableMinutes} onChangeText={(value) => update('availableMinutes', value.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="e.g. 240" />

        <View style={[styles.divider, { marginTop: spacing.lg }]} />
        <Text style={typography.small}>
          Scheduled: {localReview.scheduledMinutes} min · Focus: {localReview.focusedMinutes} min
        </Text>
      </View>

      {localReview.warnings.map((warning) => (
        <Banner key={`${warning.code}-${warning.itemId ?? 'plan'}`} tone="warning">{warning.message}</Banner>
      ))}

      {unfinished.length > 0 && date <= new Date().toISOString().slice(0, 10) ? (
        <View style={styles.card}>
          <Text style={typography.h3}>Review unfinished priorities</Text>
          <Text style={[typography.tiny, { marginTop: spacing.xs }]}>These priorities have not reached their planned focused time. Review them before moving them to tomorrow.</Text>
          {unfinished.map((item) => (
            <Text key={item.id} style={[typography.small, { marginTop: spacing.xs }]}>• {item.text} · {item.actualMinutes ?? 0}/{item.estimatedMinutes ?? 0} min</Text>
          ))}
          <Pressable style={[styles.button, styles.buttonSecondary, { marginTop: spacing.md }, carryBusy && styles.buttonDisabled]} onPress={carryForward} disabled={carryBusy}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>{carryBusy ? 'Moving…' : 'Move unfinished to tomorrow'}</Text>
          </Pressable>
        </View>
      ) : null}
      {serverWarnings.filter((warning) => !localReview.warnings.some((item) => item.code === warning.code && item.itemId === warning.itemId)).map((warning) => (
        <Banner key={`server-${warning.code}-${warning.itemId ?? 'plan'}`} tone="warning">{warning.message}</Banner>
      ))}

      <Button label="Save daily plan" onPress={save} loading={saving} disabled={saving} />

      <Button label="Review plan" variant="secondary" onPress={checkWithAi} loading={reviewBusy} disabled={reviewBusy} style={{ marginTop: spacing.sm }} />

      {aiReview ? (
        <View style={[styles.card, { marginTop: spacing.md, borderLeftWidth: 3, borderLeftColor: aiReview.qualitySource === 'ai' ? colors.primary : colors.warning }]}>
          <Text style={typography.h3}>Plan review</Text>
          <Text style={[typography.small, { marginTop: spacing.xs }]}>{aiReview.summary}</Text>
          {aiReview.suggestions?.map((suggestion, index) => (
            <View key={`${suggestion.itemId}-${index}`} style={{ marginTop: spacing.sm }}>
              <Text style={typography.small}>• {suggestion.suggestion}</Text>
              <Text style={typography.tiny}>{suggestion.reason}</Text>
            </View>
          ))}
          <Text style={[typography.tiny, { marginTop: spacing.sm }]}>Suggestions are optional; your saved plan is unchanged.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

