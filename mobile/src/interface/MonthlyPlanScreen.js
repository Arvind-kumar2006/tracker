import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, LoadingState } from './components.js';

const currentMonth = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const emptyPlan = { goal: '', focusAreas: '', milestones: '' };

export function MonthlyPlanScreen({ navigation }) {
  const month = currentMonth();
  const [plan, setPlan] = useState(emptyPlan);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const result = await container.loadMonth(month);
    setLoading(false);
    if (result.ok) setPlan({ ...emptyPlan, ...(result.value.monthlyPlan ?? {}) });
    else if (result.error.status !== 404) setError(result.error.message);
  }, [month]);

  useEffect(() => { load(); }, [load]);
  if (loading) return <SafeAreaView style={styles.screen}><LoadingState label="Loading the monthly plan…" /></SafeAreaView>;

  const update = (key, value) => { setMessage(null); setPlan((current) => ({ ...current, [key]: value })); };
  const save = async () => {
    setSaving(true); setError(null); setMessage(null);
    const result = await container.saveMonthPlan(month, plan);
    setSaving(false);
    if (!result.ok) setError(result.error.message);
    else setMessage('Monthly plan saved.');
  };
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} hitSlop={8} style={{ paddingVertical: spacing.sm }}><Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>‹ Back</Text></Pressable>
        <View style={styles.heroCard}><Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>MONTHLY PLAN · {month}</Text><Text style={[typography.h1, { marginTop: spacing.sm }]}>Set the direction</Text><Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.xs }]}>Keep this short enough to guide weekly outcomes.</Text></View>
        {error ? <Banner tone="negative">{error}</Banner> : null}
        {message ? <Banner tone="positive">{message}</Banner> : null}
        <View style={styles.card}>
          {[['goal', 'Monthly goal', 'What should be true by the end of this month?'], ['focusAreas', 'Focus areas', 'List the areas that deserve attention.'], ['milestones', 'Milestones', 'Write milestones and target dates.']].map(([key, label, placeholder], index) => (
            <View key={key} style={index ? styles.fieldDivider : null}>
              <Text style={typography.h3}>{label}</Text>
              <TextInput accessible accessibilityLabel={label} value={plan[key]} onChangeText={(value) => update(key, value)} placeholder={placeholder} placeholderTextColor={colors.textMuted} multiline style={[styles.input, { minHeight: 88, textAlignVertical: 'top', marginTop: spacing.sm }]} />
            </View>
          ))}
        </View>
        <Button label="Save monthly plan" onPress={save} loading={saving} disabled={saving} />
      </ScrollView>
    </SafeAreaView>
  );
}
