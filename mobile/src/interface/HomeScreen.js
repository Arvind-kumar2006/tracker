import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { today } from '../domain/weeklyPlan.js';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { Banner, Button } from './components.js';

export function HomeScreen({ navigation }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [reminderVisible, setReminderVisible] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const result = await container.loadWeeklyStatus(today());
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError(null);
      setStatus(result.value);
      setReminderVisible(Boolean(result.value.reminder));
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = navigation.addListener('focus', load);
    const interval = setInterval(load, 60 * 60 * 1000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [load, navigation]);

  const week = status?.currentWeek;
  const weekStart = week?.weekStart;
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>STUDY ACCOUNTABILITY</Text>
          <Text style={[typography.display, { marginTop: spacing.sm }]}>Keep the week honest.</Text>
          <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.sm }]}>Plan on paper, then use the daily tracker to compare intention with what happened.</Text>
          <Button label="Open today's plan" onPress={() => navigation.navigate('DailyPlan')} style={{ marginTop: spacing.xl }} />
        </View>

        {error ? <Banner tone="warning">Could not check the weekly reminder: {error}</Banner> : null}
      </ScrollView>

      <Modal visible={Boolean(reminderVisible && status?.reminder)} transparent animationType="fade" onRequestClose={() => setReminderVisible(false)}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.card}>
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>WEEKLY CHECK-IN</Text>
            <Text style={[typography.h1, { marginTop: spacing.sm }]}>Plan Week {week?.weekNumber}</Text>
            <Text style={[typography.body, { marginTop: spacing.sm }]}>Complete the paper exercise and upload a clear photo. This reminder stays available until the plan is confirmed.</Text>
            <Button label="Plan this week" onPress={() => { setReminderVisible(false); navigation.navigate('WeeklyPlan', { weekStart }); }} disabled={!weekStart} style={{ marginTop: spacing.xl }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Remind me later" onPress={() => setReminderVisible(false)} style={{ alignItems: 'center', padding: spacing.md }}>
              <Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>Remind me later</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const modalStyles = {
  backdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderColor: colors.primarySoft, borderWidth: 1, borderRadius: radius.xl, padding: spacing.xl },
};
