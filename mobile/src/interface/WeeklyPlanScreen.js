import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
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
    setMessage('Image read. Check the extracted summary below. If anything is missing, upload a clearer image.');
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

  if (loading) return <SafeAreaView style={styles.screen}><LoadingState label="Loading the weekly exercise…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>WRITE ON PAPER</Text>
            <Text style={[typography.h2, { marginTop: spacing.sm }]}>Review last week</Text>
            {QUESTIONS.slice(0, 3).map(([, question]) => <Text key={question} style={[typography.body, { marginTop: spacing.md }]}>{question}</Text>)}
            <Text style={[typography.h2, { marginTop: spacing.xl }]}>Plan this week</Text>
            {QUESTIONS.slice(3).map(([, question]) => <Text key={question} style={[typography.body, { marginTop: spacing.md }]}>{question}</Text>)}
            <Text style={[typography.body, { marginTop: spacing.xl }]}>Plan across:</Text>
            <Text style={[typography.small, { marginTop: spacing.xs, lineHeight: 23 }]}>{WEEK_DAYS.join(' | ')}</Text>
            <Text style={[typography.body, { marginTop: spacing.lg }]}>For each daily block, write:</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>Type — action → result — start to hard stop</Text>
          </View>

          <View style={styles.card}>
            <Text style={typography.h2}>Upload the completed sheet</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>There is nothing to fill in here. Take a clear photo of the paper or upload the image, then the app will read and save it.</Text>
            {image?.uri ? <Image source={{ uri: image.uri }} accessibilityLabel="Uploaded weekly planning sheet" style={{ width: '100%', height: 240, borderRadius: radius.md, marginTop: spacing.md, backgroundColor: colors.surfaceMuted }} resizeMode="contain" /> : null}
            <Button label="Take a photo" variant="secondary" onPress={() => chooseImage('camera')} style={{ marginTop: spacing.md }} />
            <Button label="Upload an image" variant="secondary" onPress={() => chooseImage('library')} style={{ marginTop: spacing.sm }} />
            <Button label="Upload and read image" onPress={extract} loading={working} disabled={working || !image} style={{ marginTop: spacing.md }} />
          </View>

          {status === 'AWAITING_CONFIRMATION' || status === 'COMPLETED' ? (
            <View style={styles.card}>
              <Text style={typography.h2}>Confirmation</Text>
              <Text style={[typography.small, { marginTop: spacing.xs }]}>After reading, the app shows a summary for confirmation. If the image is unclear, upload a clearer one.</Text>
              <View style={[styles.metricPanel, { marginTop: spacing.md }]}>
                <Text style={[typography.tiny, { color: colors.primarySoft }]}>EXTRACTED SUMMARY</Text>
                <Text style={[typography.small, { marginTop: spacing.sm }]}>Answers read: {Object.values(plan.answers ?? {}).filter(Boolean).length}/7</Text>
                <Text style={[typography.small, { marginTop: spacing.xs }]}>Weekly outcomes: {plan.outcomes?.length ?? 0}</Text>
                <Text style={[typography.small, { marginTop: spacing.xs }]}>Daily time blocks: {plan.dailyBlocks?.length ?? 0}</Text>
              </View>
              <Button label={status === 'COMPLETED' ? 'Update confirmed plan' : 'Confirm and save weekly plan'} onPress={confirm} loading={working} disabled={working} style={{ marginTop: spacing.md }} />
            </View>
          ) : null}

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
    </SafeAreaView>
  );
}
