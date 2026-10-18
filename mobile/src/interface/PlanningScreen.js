import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { Button } from './components.js';

export function PlanningScreen({ navigation }) {
  const [selected, setSelected] = useState('week');
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>PLANNING</Text>
          <Text style={[typography.h1, { marginTop: spacing.sm }]}>Choose your horizon</Text>
          <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.xs }]}>The weekly plan is handwritten and reviewed from a photo. The monthly plan keeps the bigger direction visible.</Text>
        </View>
        <View style={[styles.row, styles.segmented, { marginBottom: spacing.lg }]}>
          {[['week', 'Week plan'], ['month', 'Monthly plan']].map(([value, label]) => (
            <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: selected === value }} onPress={() => setSelected(value)} style={[{ flex: 1, minHeight: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }, selected === value && { backgroundColor: colors.primary }]}>
              <Text style={[typography.small, selected === value && { color: colors.white, fontWeight: '700' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.card}>
          {selected === 'week' ? (
            <>
              <Text style={typography.h2}>Weekly planning exercise</Text>
              <Text style={[typography.body, { marginTop: spacing.sm }]}>Use one A4 sheet, answer the seven questions by hand, then upload a clear photo for extraction and confirmation.</Text>
              <Button label="Open Week plan" onPress={() => navigation.navigate('WeeklyPlan')} style={{ marginTop: spacing.lg }} />
            </>
          ) : (
            <>
              <Text style={typography.h2}>Monthly direction</Text>
              <Text style={[typography.body, { marginTop: spacing.sm }]}>Set the month’s goal, focus areas, and milestones before turning them into weekly outcomes.</Text>
              <Button label="Open Monthly plan" onPress={() => navigation.navigate('MonthlyPlan')} style={{ marginTop: spacing.lg }} />
            </>
          )}
          <Button label="Open today's plan" variant="secondary" onPress={() => navigation.navigate('DailyPlan')} style={{ marginTop: spacing.sm }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
