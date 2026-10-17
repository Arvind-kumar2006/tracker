import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { formatDate } from '../domain/index.js';
import { MAX_DAILY_PRIORITIES, emptyDailyPlan, planToForm, planToPayload } from '../domain/dailyPlan.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, LoadingState } from './components.js';

const today = () => new Date().toISOString().slice(0, 10);

const shiftDate = (date, amount) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

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
    style={[styles.input, { minHeight: multiline ? 72 : 48, textAlignVertical: multiline ? 'top' : 'center' }]}
  />
);

export function SimplePlanScreen({ route, navigation }) {
  const date = route.params?.date ?? today();
  const [form, setForm] = useState(emptyDailyPlan());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
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

  const updateItem = useCallback((index, key, value) => {
    setSaved(false);
    setForm((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  }, []);

  const addItem = useCallback(() => {
    setSaved(false);
    setForm((current) => {
      if (current.items.length >= MAX_DAILY_PRIORITIES) return current;
      return {
        ...current,
        items: [...current.items, {
          id: `new-${current.items.length + 1}`,
          text: '',
          outcome: '',
          estimatedMinutes: '30',
          priority: 'MEDIUM',
        }],
      };
    });
  }, []);

  const removeItem = useCallback((index) => {
    if (index === 0) return;
    Alert.alert('Remove optional item?', 'It will be removed from this unsaved plan.', [
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
    const payload = planToPayload(form);
    if (payload.items.length === 0) {
      setError('Write at least one thing you want to do.');
      return;
    }

    setSaving(true);
    setError(null);
    const res = await container.saveDailyPlan(date, payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setForm(planToForm(res.value.plan));
    setSaved(true);
  }, [date, form]);

  const plannedMinutes = form.items
    .filter((item) => item.text.trim())
    .reduce((total, item) => total + (Number(item.estimatedMinutes) || 0), 0);

  if (loading) return <LoadingState label="Loading your plan…" />;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.rowBetween}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text style={typography.h1}>Plan</Text>
          <Text style={[typography.small, { marginTop: spacing.xs }]}>Morning or night · {formatDate(date)}</Text>
        </View>
        <View style={styles.row}>
          <Pressable accessible accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => navigation.navigate('DailyPlan', { date: shiftDate(date, -1) })} style={styles.chip}>
            <Text style={[typography.h2, { color: colors.primarySoft }]}>‹</Text>
          </Pressable>
          <Pressable accessible accessibilityRole="button" accessibilityLabel="Next day" onPress={() => navigation.navigate('DailyPlan', { date: shiftDate(date, 1) })} style={[styles.chip, { marginRight: 0 }]}>
            <Text style={[typography.h2, { color: colors.primarySoft }]}>›</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Banner tone="negative">{error}</Banner> : null}
      {saved ? <Banner tone="positive">Plan saved. Come back tomorrow morning or tonight to adjust it.</Banner> : null}

      <View style={[styles.card, { marginTop: spacing.lg, borderColor: colors.primary + '66' }]}>
        <Text style={typography.tiny}>KEEP IT SMALL</Text>
        <Text style={[typography.h2, { marginTop: spacing.xs }]}>One must-do. Two optional things.</Text>
        <Text style={[typography.small, { marginTop: spacing.xs }]}>Write the next visible action, not a whole subject. Use minutes to keep the plan honest.</Text>
      </View>

      {form.items.map((item, index) => (
        <View key={item.id} style={[styles.card, { marginTop: spacing.md, borderLeftWidth: 3, borderLeftColor: index === 0 ? colors.primarySoft : colors.border }]}>
          <View style={styles.rowBetween}>
            <Text style={typography.tiny}>{index === 0 ? 'MUST-DO' : `OPTIONAL ${index}`}</Text>
            {index > 0 ? (
              <Pressable accessible accessibilityRole="button" accessibilityLabel={`Remove optional item ${index}`} onPress={() => removeItem(index)} hitSlop={8}>
                <Text style={[typography.tiny, { color: colors.negative }]}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <Field
            value={item.text}
            onChangeText={(value) => updateItem(index, 'text', value)}
            placeholder={index === 0 ? 'What must happen tomorrow?' : 'What else would help?'}
            accessibilityLabel={index === 0 ? 'Must-do plan item' : `Optional plan item ${index}`}
            multiline
          />
          <View style={[styles.rowBetween, { marginTop: spacing.sm, alignItems: 'center' }]}>
            <Text style={typography.tiny}>MINUTES</Text>
            <TextInput
              accessible
              accessibilityLabel={`${index === 0 ? 'Must-do' : 'Optional'} minutes`}
              value={String(item.estimatedMinutes ?? '')}
              onChangeText={(value) => updateItem(index, 'estimatedMinutes', value.replace(/\D/g, ''))}
              placeholder="30"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              style={[styles.input, { width: 96, minHeight: 44, marginTop: 0, textAlign: 'center' }]}
            />
          </View>
          {Number(item.actualMinutes) > 0 ? (
            <Text style={[typography.tiny, { color: colors.positive, marginTop: spacing.sm }]}>Already focused: {item.actualMinutes} min</Text>
          ) : null}
        </View>
      ))}

      {form.items.length < MAX_DAILY_PRIORITIES ? (
        <Pressable style={[styles.button, styles.buttonSecondary, { marginTop: spacing.md }]} onPress={addItem}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Add optional thing</Text>
        </Pressable>
      ) : null}

      <View style={[styles.card, { marginTop: spacing.md }]}>
        <Text style={typography.h3}>Plan size</Text>
        <Text style={[typography.small, { marginTop: spacing.xs }]}>{plannedMinutes} minutes planned. Stop when the must-do is done.</Text>
      </View>

      <Button label="Save plan" onPress={save} loading={saving} disabled={saving} style={{ marginTop: spacing.md }} />
      </ScrollView>
    </SafeAreaView>
  );
}
