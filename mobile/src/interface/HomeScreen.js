import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { today } from '../domain/weeklyPlan.js';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { Banner, Button } from './components.js';

export function HomeScreen({ navigation }) {
  const [status, setStatus] = useState(null);
  const [monthlyStatus, setMonthlyStatus] = useState(null);
  const [error, setError] = useState(null);
  const [reminderVisible, setReminderVisible] = useState(false);
  const [activeReminder, setActiveReminder] = useState(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const date = today();
      const [weekly, monthly] = await Promise.all([
        container.loadWeeklyStatus(date),
        container.loadMonthlyStatus(date),
      ]);
      const errors = [weekly, monthly].filter((result) => !result.ok).map((result) => result.error.message);
      setError(errors.length ? errors.join(' · ') : null);
      if (weekly.ok) setStatus(weekly.value);
      if (monthly.ok) setMonthlyStatus(monthly.value);
      const nextReminder = monthly.ok && monthly.value.reminder
        ? 'monthly'
        : weekly.ok && weekly.value.reminder
          ? 'weekly'
          : null;
      setActiveReminder(nextReminder);
      setReminderVisible(Boolean(nextReminder));
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
  const plannedMonth = monthlyStatus?.currentMonth;
  const monthlyReminder = activeReminder === 'monthly' && monthlyStatus?.reminder;
  const weeklyReminder = activeReminder === 'weekly' && status?.reminder;
  const openReminder = () => {
    setReminderVisible(false);
    if (activeReminder === 'monthly') navigation.navigate('MonthlyPlan', { month: plannedMonth?.month });
    if (activeReminder === 'weekly') navigation.navigate('WeeklyPlan', { weekStart });
  };
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>STUDY ACCOUNTABILITY</Text>
          <Text style={[typography.display, { marginTop: spacing.sm }]}>Keep the week honest.</Text>
          <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.sm }]}>Plan on paper, then use the daily tracker to compare intention with what happened.</Text>
          <Button label="Open today's plan" onPress={() => navigation.navigate('DailyPlan')} style={{ marginTop: spacing.xl }} />
        </View>

        {error ? <Banner tone="warning">Could not check planning reminders: {error}</Banner> : null}
      </ScrollView>

      <Modal visible={Boolean(reminderVisible && (monthlyReminder || weeklyReminder))} transparent animationType="fade" onRequestClose={() => { setReminderVisible(false); setActiveReminder(null); }}>
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.card}>
            {monthlyReminder ? <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>MONTHLY CHECK-IN</Text> : null}
            {weeklyReminder ? <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>WEEKLY CHECK-IN</Text> : null}
            <Text style={[typography.h1, { marginTop: spacing.sm }]}>{monthlyReminder ? `Plan ${plannedMonth?.monthName} ${plannedMonth?.year}` : `Plan Week ${week?.weekNumber}`}</Text>
            <Text style={[typography.body, { marginTop: spacing.sm }]}>Complete the paper exercise and upload a clear photo. This reminder stays available until the plan is confirmed.</Text>
            <Button label={monthlyReminder ? 'Plan this month' : 'Plan this week'} onPress={openReminder} disabled={monthlyReminder ? !plannedMonth?.month : !weekStart} style={{ marginTop: spacing.xl }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Remind me later" onPress={() => { setReminderVisible(false); setActiveReminder(null); }} style={{ alignItems: 'center', padding: spacing.md }}>
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
