import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { formatDate } from '../domain/index.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, EmptyState, LoadingState } from './components.js';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const shiftDate = (date, amount) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

const emptyForm = () => ({
  achievement: '',
  built: '',
  obstacles: '',
  tomorrowFix: '',
});

const blockerText = (value) => {
  if (value && typeof value === 'object') return value.raw ?? value.segments?.join('\n') ?? '';
  return value ?? '';
};

const normalisePlanItems = (items) => (items ?? []).map((item, index) => ({
  id: item.id ?? `${index}-${item.task ?? item.text ?? 'plan'}`,
  task: item.task ?? item.text ?? '',
  doneWhen: item.doneWhen ?? item.outcome ?? '',
  type: item.type ?? item.workType ?? '',
  start: item.start ?? item.startTime ?? '',
  end: item.end ?? item.endTime ?? '',
  minutes: Number(item.minutes ?? item.estimatedMinutes) || 0,
  isMust: Boolean(item.isMust ?? item.priority === 'HIGH'),
  status: item.status ?? 'PLANNED',
}));

const formatPlanTime = (value) => {
  if (!value) return '';
  const [hours, minutes] = String(value).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

const formatPlanStatus = (value) => ({
  DONE: 'Done',
  PARTIAL: 'Partly',
  PARTLY: 'Partly',
  MOVED: 'Moved to buffer',
  MOVED_TO_BUFFER: 'Moved to buffer',
}[String(value ?? '').toUpperCase()] ?? 'Planned');

const formFromEntry = (entry) => ({
  achievement: entry?.accomplished ?? '',
  built: entry?.buildNote ?? '',
  obstacles: blockerText(entry?.blockers),
  tomorrowFix: entry?.tomorrowChange ?? '',
});

const formToPayload = (form) => ({
  accomplished: form.achievement.trim() || null,
  buildNote: form.built.trim() || null,
  blockers: form.obstacles.trim() || null,
  tomorrowChange: form.tomorrowFix.trim() || null,
});

const QUESTIONS = [
  {
    key: 'achievement',
    label: 'Accomplishment',
    question: 'What did I accomplish today?',
    placeholder: 'Example: Completed my biology assignment.',
  },
  {
    key: 'built',
    label: 'Built, finished, or produced',
    question: 'What did I build, finish, or produce?',
    placeholder: 'Example: Finished the introduction and two body paragraphs.',
  },
  {
    key: 'obstacles',
    label: 'Blockers or slowdowns',
    question: 'What blocked or slowed me down?',
    placeholder: 'Example: Started late because I spent too much time on my phone.',
  },
  {
    key: 'tomorrowFix',
    label: 'One change for tomorrow',
    question: 'What one change will I make tomorrow?',
    placeholder: 'Example: Start studying immediately after dinner.',
  },
];

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
  const [form, setForm] = useState(emptyForm);
  const [planItems, setPlanItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncWarning, setSyncWarning] = useState(null);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [coach, setCoach] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadError(null);
    setSaved(false);
    setCoach(null);
    setCoachError(null);
    const res = await container.loadDay(date);
    setLoading(false);
    if (!res.ok && res.error.status !== 404) {
      setLoadError(res.error.message);
      return;
    }
    setForm(res.ok ? formFromEntry(res.value) : emptyForm());
    setPlanItems(res.ok ? normalisePlanItems(res.value.plan?.items) : []);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const updateField = useCallback((field, value) => {
    setSaved(false);
    setSyncWarning(null);
    setCoach(null);
    setCoachError(null);
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const loadCoach = useCallback(async () => {
    setCoachLoading(true);
    setCoachError(null);
    const res = await container.loadReflectionCoach(date);
    setCoachLoading(false);
    if (!res.ok) {
      setCoachError(res.error.message);
      return;
    }
    setCoach(res.value);
  }, [date]);

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
    void loadCoach();
  }, [date, form, loadCoach]);

  if (loading) {
    return <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}><LoadingState label="Loading your reflection…" /></SafeAreaView>;
  }
  if (loadError) {
    return <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}><EmptyState title="Reflection unavailable" message={loadError} action="Retry" onAction={load} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCard}>
            <View style={styles.rowBetween}>
              <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>END-OF-DAY CHECK-IN</Text>
              <Pressable accessible accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => navigation.navigate('Settings')} hitSlop={8} style={styles.settingsButton}>
                <Text style={{ color: colors.primarySoft, fontSize: 18 }}>⚙</Text>
              </Pressable>
            </View>
            <Text style={[typography.h1, { marginTop: spacing.sm }]}>Reflect on your day</Text>
            <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.xs }]}>Notice what happened, what you created, what got in the way, and how you will improve tomorrow.</Text>
            <View style={[styles.rowBetween, { marginTop: spacing.xl }]}>
              <View style={styles.datePill}><Text style={[typography.small, { color: colors.text }]}>{formatDate(date)}</Text></View>
              <View style={styles.row}>
                <Pressable accessible accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => navigation.navigate('Reflection', { date: shiftDate(date, -1) })} style={[styles.chip, { marginBottom: 0 }]}>
                  <Text style={[typography.h2, { color: colors.primarySoft }]}>‹</Text>
                </Pressable>
                <Pressable accessible accessibilityRole="button" accessibilityLabel="Next day" onPress={() => navigation.navigate('Reflection', { date: shiftDate(date, 1) })} style={[styles.chip, { marginRight: 0, marginBottom: 0 }]}>
                  <Text style={[typography.h2, { color: colors.primarySoft }]}>›</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {error ? <Banner tone="negative">{error}</Banner> : null}

          <View style={[styles.card, { marginTop: spacing.md }]}>
            <View style={styles.rowBetween}>
              <Text style={typography.h2}>Today's plan</Text>
              <Text style={typography.tiny}>{planItems.length} {planItems.length === 1 ? 'block' : 'blocks'}</Text>
            </View>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>Compare your intention with what actually happened.</Text>
            {planItems.length === 0 ? (
              <Text style={[typography.small, { marginTop: spacing.md }]}>No plan saved for this day.</Text>
            ) : planItems.map((item) => (
              <View key={item.id} style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft }}>
                <View style={styles.rowBetween}>
                  <Text style={[typography.tiny, { color: colors.primarySoft }]}>
                    {item.isMust ? '★ ' : ''}{formatPlanTime(item.start)}{item.end ? ` – ${formatPlanTime(item.end)}` : ''}
                  </Text>
                  <Text style={typography.tiny}>{formatPlanStatus(item.status)}{item.minutes ? ` · ${item.minutes} min` : ''}</Text>
                </View>
                <Text style={[typography.h3, { marginTop: spacing.xs }]}>{item.task || 'Untitled block'}</Text>
                {item.doneWhen ? <Text style={[typography.small, { marginTop: spacing.xs }]}>Done when: {item.doneWhen}</Text> : null}
                {item.type ? <Text style={[typography.tiny, { marginTop: spacing.xs }]}>{item.type}</Text> : null}
              </View>
            ))}
          </View>

          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>FOUR SHORT ANSWERS</Text>
            {QUESTIONS.map((question, index) => (
              <View key={question.key} style={index ? styles.fieldDivider : { marginTop: spacing.lg }}>
                <Text style={typography.tiny}>{question.label.toUpperCase()}</Text>
                <Text style={[typography.h3, { marginTop: spacing.xs }]}>{question.question}</Text>
                <TextAnswer
                  value={form[question.key]}
                  onChangeText={(value) => updateField(question.key, value)}
                  placeholder={question.placeholder}
                  accessibilityLabel={question.question}
                />
                {question.key === 'obstacles' ? (
                  <Text style={[typography.tiny, { marginTop: spacing.xs }]}>Enter “Nothing” if there were no obstacles.</Text>
                ) : null}
              </View>
            ))}
          </View>

          <Button label="Save reflection" onPress={save} loading={saving} disabled={saving} style={{ marginTop: spacing.lg }} />
          {saved ? (
            <View style={{ marginTop: spacing.md }}>
              <Banner tone="positive">Reflection saved.</Banner>
              {syncWarning ? <Banner tone="warning">{syncWarning}</Banner> : null}
              <View style={[styles.card, { marginTop: spacing.md }]}>
                <Text style={typography.h2}>Saved reflection · {formatDate(date)}</Text>
                {QUESTIONS.map((question) => (
                  <View key={question.key} style={{ marginTop: spacing.md }}>
                    <Text style={typography.tiny}>{question.label.toUpperCase()}</Text>
                    <Text style={[typography.body, { marginTop: spacing.xs }]}>{form[question.key].trim() || 'Nothing entered.'}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.card, { marginTop: spacing.sm, borderColor: colors.primaryTint }]}>
                <View style={styles.rowBetween}>
                  <View>
                    <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>QUICK REVIEW</Text>
                    <Text style={[typography.h2, { marginTop: spacing.xs }]}>Three useful signals</Text>
                  </View>
                  {coachLoading ? <ActivityIndicator color={colors.primarySoft} /> : null}
                </View>
                {coachError ? <Banner tone="warning">Could not generate the quick review: {coachError}</Banner> : null}
                {coach ? [
                  ['Observation', coach.observation],
                  ['Obstacle pattern', coach.obstaclePattern],
                  ['Tomorrow', coach.tomorrowSuggestion],
                ].map(([label, value]) => (
                  <View key={label} style={styles.fieldDivider}>
                    <Text style={[typography.tiny, { color: colors.primarySoft }]}>{label.toUpperCase()}</Text>
                    <Text style={[typography.body, { marginTop: spacing.xs }]}>{value}</Text>
                  </View>
                )) : null}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
