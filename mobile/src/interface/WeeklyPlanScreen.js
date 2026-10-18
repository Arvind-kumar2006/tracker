import React, { useCallback, useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { emptyWeeklyPlan, planFromRecord, today, weekStartForDate, WEEK_DAYS } from '../domain/weeklyPlan.js';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { Banner, Button, LoadingState } from './components.js';

const QUESTIONS = [
  ['reviewLastWeek', '1. What did I plan, and what did I actually complete?'],
  ['blockers', '2. What blocked or delayed me?'],
  ['plannedChange', '3. What one change will I make this week?'],
  ['successOutcomes', '4. What 1–3 outcomes would make this week successful?'],
  ['deliverables', '5. What will I build, finish, or produce for each outcome, and by which day?'],
  ['fixedCommitments', '6. What fixed commitments do I have, and when will I work on each outcome?'],
  ['fitAssessment', '7. Does this plan fit my real time and energy? If not, what will I remove or postpone?'],
];

const answerPlaceholder = (key) => ({
  reviewLastWeek: 'Write what you planned and what you actually completed.',
  blockers: 'Write the obstacles or delays you noticed.',
  plannedChange: 'Write one change you will make this week.',
  successOutcomes: 'List one to three outcomes.',
  deliverables: 'For each outcome, write the concrete result and completion day.',
  fixedCommitments: 'Write fixed commitments and when each outcome will happen.',
  fitAssessment: 'Write whether the plan fits your real time and energy. Note what you will remove or postpone.',
}[key]);

const Field = ({ value, onChangeText, placeholder, label }) => (
  <TextInput
    accessible
    accessibilityLabel={label}
    value={String(value ?? '')}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={colors.textMuted}
    multiline
    style={[styles.input, { minHeight: 78, textAlignVertical: 'top', marginTop: spacing.sm }]}
  />
);

const emptyOutcome = () => ({ outcome: '', deliverable: '', completionDay: '' });
const emptyBlock = (day = 'Monday') => ({ day, type: '', action: '', result: '', start: '', hardStop: '' });

export function WeeklyPlanScreen({ route, navigation }) {
  const requestedWeek = route.params?.weekStart ?? weekStartForDate(today());
  const [week, setWeek] = useState({ weekStart: requestedWeek, weekEnd: '', weekNumber: '' });
  const [plan, setPlan] = useState(emptyWeeklyPlan(requestedWeek));
  const [image, setImage] = useState(null);
  const [status, setStatus] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [warning, setWarning] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await container.loadWeeklyPlan(requestedWeek);
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setWeek(result.value.week);
    setStatus(result.value.record?.status ?? null);
    setAnalytics(result.value.analytics ?? null);
    setPlan(planFromRecord(result.value.record, requestedWeek));
    if (result.value.record?.status === 'COMPLETED') setMessage('This week is already confirmed. You can review it below.');
  }, [requestedWeek]);

  useEffect(() => { load(); }, [load]);

  const updateAnswer = (key, value) => {
    setMessage(null);
    setPlan((current) => ({ ...current, answers: { ...current.answers, [key]: value }, ...(key === 'plannedChange' ? { plannedChange: value } : {}) }));
  };

  const chooseImage = async (source) => {
    setError(null);
    setMessage(null);
    try {
      const ImagePicker = await import('expo-image-picker');
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(source === 'camera' ? 'Camera access is needed to take the weekly-plan photo.' : 'Photo-library access is needed to upload the weekly-plan image.');
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.82, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.82, base64: true });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        setError('The selected image could not be read. Please choose a clear JPG or PNG image again.');
        return;
      }
      setImage({ uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType ?? (asset.fileName?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'), fileName: asset.fileName ?? 'weekly-plan-image' });
      setWarning(null);
    } catch (pickError) {
      setError(pickError.message ?? 'Could not open the camera or photo library.');
    }
  };

  const extract = async () => {
    if (!image) {
      setError('Take a photo or upload an image first.');
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    const result = await container.extractWeeklyPlan(requestedWeek, image);
    setWorking(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setPlan(planFromRecord(result.value.plan ?? result.value.record, requestedWeek));
    setStatus('AWAITING_CONFIRMATION');
    setWarning(result.value.warning ?? null);
    setMessage('Review the extracted text below. Correct anything that is wrong before confirming.');
  };

  const confirm = async () => {
    setWorking(true);
    setError(null);
    const result = await container.confirmWeeklyPlan(requestedWeek, plan);
    setWorking(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setStatus('COMPLETED');
    setPlan(planFromRecord(result.value.record, requestedWeek));
    const refreshed = await container.loadWeeklyPlan(requestedWeek);
    if (refreshed.ok) setAnalytics(refreshed.value.analytics ?? null);
    setMessage('Weekly plan confirmed and saved.');
    setWarning(result.value.sheets?.synced === false && !result.value.sheets?.skipped ? `Saved, but Sheets sync failed: ${result.value.sheets.error}` : null);
  };

  const addOutcome = () => setPlan((current) => ({ ...current, outcomes: [...current.outcomes, emptyOutcome()].slice(0, 3) }));
  const updateOutcome = (index, key, value) => setPlan((current) => ({ ...current, outcomes: current.outcomes.map((item, i) => i === index ? { ...item, [key]: value } : item) }));
  const addBlock = (day) => setPlan((current) => ({ ...current, dailyBlocks: [...current.dailyBlocks, emptyBlock(day)] }));
  const updateBlock = (index, key, value) => setPlan((current) => ({ ...current, dailyBlocks: current.dailyBlocks.map((item, i) => i === index ? { ...item, [key]: value } : item) }));

  if (loading) return <SafeAreaView style={styles.screen}><LoadingState label="Loading the weekly exercise…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} hitSlop={8} style={{ paddingVertical: spacing.sm }}>
            <Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>‹ Back</Text>
          </Pressable>
          <View style={styles.heroCard}>
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>WEEK {week.weekNumber || '—'} · {week.weekStart}</Text>
            <Text style={[typography.h1, { marginTop: spacing.sm }]}>Weekly planning exercise</Text>
            <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.sm }]}>Take one A4 sheet of paper and answer the following questions by hand. When finished, take a clear picture of the completed sheet and upload it.</Text>
            <Text style={[typography.small, { marginTop: spacing.md }]}>Week dates: {week.weekStart} → {week.weekEnd}</Text>
          </View>

          {error ? <Banner tone="negative">{error}</Banner> : null}
          {message ? <Banner tone="positive">{message}</Banner> : null}
          {warning ? <Banner tone="warning">{warning}</Banner> : null}
          {status === 'FAILED_TO_SUBMIT' ? <Banner tone="warning">The previous record was preserved as “Failed to submit.” This new week can still be planned now.</Banner> : null}

          <View style={styles.card}>
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>REVIEW LAST WEEK</Text>
            {QUESTIONS.slice(0, 3).map(([key, question], index) => (
              <View key={key} style={index ? styles.fieldDivider : { marginTop: spacing.lg }}>
                <Text style={typography.h3}>{question}</Text>
                <Field value={plan.answers[key]} onChangeText={(value) => updateAnswer(key, value)} placeholder={answerPlaceholder(key)} label={question} />
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>PLAN THIS WEEK</Text>
            {QUESTIONS.slice(3).map(([key, question], index) => (
              <View key={key} style={index ? styles.fieldDivider : { marginTop: spacing.lg }}>
                <Text style={typography.h3}>{question}</Text>
                <Field value={plan.answers[key]} onChangeText={(value) => updateAnswer(key, value)} placeholder={answerPlaceholder(key)} label={question} />
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text style={typography.h2}>Weekly outcomes</Text>
                <Text style={[typography.small, { marginTop: spacing.xs }]}>Write the outcome, what you will build/finish/produce, and the completion day.</Text>
              </View>
              {plan.outcomes.length < 3 ? <Pressable accessibilityRole="button" accessibilityLabel="Add weekly outcome" onPress={addOutcome}><Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>+ Add</Text></Pressable> : null}
            </View>
            {plan.outcomes.map((item, index) => (
              <View key={index} style={[styles.fieldDivider, { marginTop: spacing.md }]}>
                <Text style={typography.tiny}>OUTCOME {index + 1}</Text>
                <Field value={item.outcome} onChangeText={(value) => updateOutcome(index, 'outcome', value)} placeholder="Outcome" label={`Outcome ${index + 1}`} />
                <Field value={item.deliverable} onChangeText={(value) => updateOutcome(index, 'deliverable', value)} placeholder="Concrete deliverable" label={`Deliverable ${index + 1}`} />
                <Field value={item.completionDay} onChangeText={(value) => updateOutcome(index, 'completionDay', value)} placeholder="Completion day, e.g. Thursday" label={`Completion day ${index + 1}`} />
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={typography.h2}>Plan across Monday → Sunday</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>For each daily block, write: Type — action → result — start to hard stop.</Text>
            {WEEK_DAYS.map((day) => {
              const indexes = plan.dailyBlocks.map((block, index) => block.day === day ? index : -1).filter((index) => index >= 0);
              return (
                <View key={day} style={styles.fieldDivider}>
                  <View style={styles.rowBetween}><Text style={typography.h3}>{day}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Add ${day} block`} onPress={() => addBlock(day)}><Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>+ Add block</Text></Pressable></View>
                  {indexes.length === 0 ? <Text style={[typography.tiny, { marginTop: spacing.sm }]}>No block extracted.</Text> : indexes.map((index) => (
                    <View key={index} style={{ marginTop: spacing.sm }}>
                      {['type', 'action', 'result', 'start', 'hardStop'].map((key) => (
                        <Field key={key} value={plan.dailyBlocks[index][key]} onChangeText={(value) => updateBlock(index, key, value)} placeholder={key === 'hardStop' ? 'Hard stop' : key[0].toUpperCase() + key.slice(1)} label={`${day} ${key}`} />
                      ))}
                    </View>
                  ))}
                </View>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={typography.h2}>Upload the completed sheet</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>The image is used only to extract text. You will review and confirm every field before it is saved.</Text>
            {image?.uri ? <Image source={{ uri: image.uri }} accessibilityLabel="Uploaded weekly planning sheet" style={{ width: '100%', height: 240, borderRadius: radius.md, marginTop: spacing.md, backgroundColor: colors.surfaceMuted }} resizeMode="contain" /> : null}
            <Button label="Take a photo" variant="secondary" onPress={() => chooseImage('camera')} style={{ marginTop: spacing.md }} />
            <Button label="Upload an image" variant="secondary" onPress={() => chooseImage('library')} style={{ marginTop: spacing.sm }} />
            <Button label="Extract handwritten plan" onPress={extract} loading={working} disabled={working || !image} style={{ marginTop: spacing.md }} />
          </View>

          <View style={styles.card}>
            <Text style={typography.h2}>Confirmation</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>Correct the extracted answers, outcomes, and blocks above. Nothing is marked complete until you confirm it.</Text>
            <Button label={status === 'COMPLETED' ? 'Update confirmed plan' : 'Confirm and save weekly plan'} onPress={confirm} loading={working} disabled={working} style={{ marginTop: spacing.md }} />
          </View>

          {analytics ? (
            <View style={styles.card}>
              <Text style={typography.h2}>Weekly progress</Text>
              <Text style={[typography.small, { marginTop: spacing.sm }]}>Planned blocks: {analytics.plannedBlocks} · logged days: {analytics.actualLoggedDays}</Text>
              <Text style={[typography.small, { marginTop: spacing.xs }]}>Planned time: {analytics.plannedMinutes} min · actual time: {analytics.actualMinutes} min</Text>
              <Text style={[typography.small, { marginTop: spacing.xs }]}>Completed outcomes: {analytics.completedOutcomes}</Text>
              {analytics.repeatedObstacles?.length ? <Text style={[typography.small, { marginTop: spacing.xs }]}>Repeated obstacles: {analytics.repeatedObstacles.join(' · ')}</Text> : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
