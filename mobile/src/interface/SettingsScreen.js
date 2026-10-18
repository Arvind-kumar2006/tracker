import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, EmptyState, LoadingState, StatusPill } from './components.js';

const connectionLabel = (status) => {
  if (!status?.connected) return 'Not connected';
  return status.syncReady ? 'Ready to sync' : 'Setup needed';
};

const connectionTone = (status) => {
  if (!status?.connected) return 'neutral';
  return status.syncReady ? 'positive' : 'warning';
};

export function SettingsScreen({ navigation }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    const result = await container.loadSheetsStatus();
    if (result.ok) setStatus(result.value);
    else setError(result.error.message);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load({ initial: true }); }, [load]);

  if (loading) {
    return <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}><LoadingState label="Checking your connection…" /></SafeAreaView>;
  }

  if (error && !status) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <EmptyState title="Settings unavailable" message={error} action="Try again" onAction={() => load({ initial: true })} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>SETTINGS</Text>
          <Text style={[typography.h1, { marginTop: spacing.sm }]}>Your connection</Text>
          <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.xs }]}>Check whether your daily plans and reflections can reach Google Sheets.</Text>
        </View>

        {error ? <Banner tone="warning">Could not refresh: {error}</Banner> : null}

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={typography.tiny}>GOOGLE SHEETS</Text>
              <Text style={[typography.h2, { marginTop: spacing.xs }]}>{connectionLabel(status)}</Text>
            </View>
            <StatusPill label={status?.connected ? (status.syncReady ? 'READY' : 'ACTION NEEDED') : 'NOT CONNECTED'} tone={connectionTone(status)} />
          </View>

          <View style={[styles.metricPanel, { marginTop: spacing.lg }]}>
            <View style={styles.rowBetween}>
              <Text style={typography.small}>Sheet linked</Text>
              <Text style={[typography.small, { color: status?.connected ? colors.positive : colors.textMuted, fontWeight: '700' }]}>{status?.connected ? 'Yes' : 'No'}</Text>
            </View>
            <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
              <Text style={typography.small}>Sync ready</Text>
              <Text style={[typography.small, { color: status?.syncReady ? colors.positive : colors.warning, fontWeight: '700' }]}>{status?.syncReady ? 'Yes' : 'Not yet'}</Text>
            </View>
            <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
              <Text style={typography.small}>Credentials</Text>
              <Text style={[typography.small, { color: status?.credentialsValid ? colors.positive : colors.textMuted, fontWeight: '700' }]}>{status?.credentialsValid ? 'Valid' : 'Not verified'}</Text>
            </View>
          </View>

          {status?.url ? (
            <Pressable
              accessible
              accessibilityRole="link"
              accessibilityLabel="Open connected Google Sheet"
              onPress={() => Linking.openURL(status.url)}
              style={{ marginTop: spacing.lg }}
            >
              <Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>Open connected sheet ↗</Text>
            </Pressable>
          ) : null}

          <Button label="Refresh connection" variant="secondary" onPress={() => load()} loading={refreshing} disabled={refreshing} style={{ marginTop: spacing.lg }} />
        </View>

        <View style={styles.card}>
          <Text style={typography.h3}>What this means</Text>
          <Text style={[typography.small, { marginTop: spacing.sm }]}>Your entries are saved in the tracker first. When sync is ready, the server mirrors them to the connected sheet.</Text>
          {status?.credentialError ? <Text style={[typography.small, { color: colors.warning, marginTop: spacing.md }]}>{status.credentialError}</Text> : null}
        </View>

        <Button label="Back to plan" variant="ghost" onPress={() => navigation.goBack()} style={{ marginTop: spacing.xs }} />
      </ScrollView>
    </SafeAreaView>
  );
}
