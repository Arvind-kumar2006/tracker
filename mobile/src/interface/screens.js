/**
 * Screens.
 *
 * Kept deliberately thin: each fetches through the container and renders. All shaping and
 * arithmetic lives in src/domain, which is testable without a device.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { container } from '../shared/container.js';
import {
  buildDashboardView, monthForDate, monthGrid, formatDate, formatHours, formatPercent,
  sortBySeverity, SEVERITY_ORDER,
} from '../domain/index.js';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { StatCard, MonthGrid, CategoryBar, InsightCard, EmptyState, Banner, Chip } from './components.js';

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Dashboard                                                            */
/* ------------------------------------------------------------------ */

export function DashboardScreen({ navigation }) {
  const month = monthForDate(today());
  const [state, setState] = useState({ loading: true, error: null, view: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await container.loadDashboard({ month, asOf: today() });
    if (!res.ok) {
      setState({ loading: false, error: res.error.message, view: null });
      return;
    }
    setState({
      loading: false,
      error: null,
      view: buildDashboardView({ month, metrics: res.value.metrics, entries: res.value.entries, asOf: today() }),
    });
  }, [month]);

  useEffect(() => { load(); }, [load]);

  if (state.loading) {
    return <View style={styles.screen}><Text style={[styles.content, typography.body]}>Loading…</Text></View>;
  }
  if (state.error) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyState
          title="Can't reach the tracker"
          message={state.error}
          action="Retry"
          onAction={load}
        />
        <Text style={typography.tiny}>Pointing at {container.api.baseUrl}</Text>
      </ScrollView>
    );
  }

  const v = state.view;
  const loggedShare = v.days.length ? (v.loggedDays / Math.max(1, v.days.filter((d) => !d.isFuture).length)) * 100 : 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <Text style={typography.h1}>{month}</Text>
      <Text style={[typography.small, { marginTop: 2, marginBottom: spacing.lg }]}>
        {v.loggedDays} of {v.days.filter((d) => !d.isFuture).length} days logged
      </Text>

      <View style={styles.wrap}>
        <StatCard label="Hours" value={formatHours(v.hoursTotal)} sub={`${formatHours(v.hoursAvg)}/day`} />
        <StatCard label="Consistency" value={formatPercent(v.consistencyRate)} sub={`${Math.round(loggedShare)}% of elapsed`} />
        <StatCard label="Streak" value={`${v.currentStreak}d`} sub={`best ${v.longestStreak}`} tone="positive" />
        <StatCard
          label="Target met"
          value={`${v.daysTargetMet}`}
          sub={`${v.daysPartial} partial · ${v.daysMissed} missed`}
        />
      </View>

      {v.passiveLearningRatio > 0 ? (
        <Banner tone="warning">
          {v.passiveLearningRatio}% of logged days describe watching without building. That is the
          pattern to attack first.
        </Banner>
      ) : null}

      <Text style={styles.sectionTitle}>Month</Text>
      <View style={styles.card}>
        <MonthGrid days={v.days} />
        <View style={[styles.divider]} />
        <View style={styles.wrap}>
          <Chip label="— not logged" />
          <Chip label="~ partial" tone="warning" />
          <Chip label="✓ met" tone="positive" />
          <Chip label="✕ missed" tone="negative" />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Where the time went</Text>
      <View style={styles.card}>
        <CategoryBar split={v.categorySplit} />
      </View>

      <View style={[styles.row, { marginTop: spacing.lg }]}>
        <ActionTile label="Import folder" onPress={() => navigation.navigate('Import')} />
        <ActionTile label="Reflect" onPress={() => navigation.navigate('Reflection', { date: today() })} />
        <ActionTile label="Insights" onPress={() => navigation.navigate('Insights')} />
      </View>
      <View style={[styles.row, { marginTop: 0 }]}>
        <ActionTile label="Plan quality" onPress={() => navigation.navigate('PlanCritique')} />
        <ActionTile label="Settings" onPress={() => navigation.navigate('Settings')} />
      </View>
    </ScrollView>
  );
}

const ActionTile = ({ label, onPress }) => (
  <Pressable onPress={onPress} style={[styles.card, { flex: 1, marginRight: spacing.sm, padding: spacing.md, alignItems: 'center' }]}>
    <Text style={[typography.small, { color: colors.primary, fontWeight: '600', textAlign: 'center' }]}>{label}</Text>
  </Pressable>
);

/* ------------------------------------------------------------------ */
/* Import                                                               */
/* ------------------------------------------------------------------ */

export function ImportScreen({ navigation }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const choose = useCallback(async () => {
    setBusy(true); setError(null); setResult(null); setPreview(null);
    try {
      const res = await container.importWorkbooks({});
      if (!res.ok) {
        if (res.error.code !== 'CANCELLED') setError(res.error.message);
        return;
      }
      setPreview(res.value);
    } finally {
      setBusy(false);
    }
  }, []);

  const confirm = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await preview.upload();
      if (!res.ok) { setError(res.error.message); return; }
      setResult(res.value);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [preview]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Import</Text>
      <Text style={[typography.small, { marginTop: 4, marginBottom: spacing.lg }]}>
        Pick the folder holding your .xlsx trackers. Files are parsed on the server, so nothing is
        stored on the phone.
      </Text>

      {error ? <Banner tone="negative">{error}</Banner> : null}

      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={choose} disabled={busy}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>{busy ? 'Choosing…' : 'Choose .xlsx files'}</Text>
      </Pressable>

      <Text style={[typography.tiny, { marginTop: spacing.md, lineHeight: 16 }]}>
        iOS and Android do not let an app enumerate the contents of a folder it has been granted,
        so the system file picker is used instead. To import every workbook in a folder at once,
        run a folder import on the server, which reads them directly from disk.
      </Text>

      {preview ? (
        <View style={[styles.card, { marginTop: spacing.lg }]}>
          <Text style={typography.h3}>Found {preview.fileCount} file(s)</Text>
          <Text style={[typography.small, { marginTop: 2 }]}>{Math.round(preview.totalBytes / 1024)} KB total</Text>
          <View style={styles.divider} />
          {preview.files.map((f) => (
            <Text key={f.name} style={[typography.small, { marginBottom: 2 }]}>
              • {f.name} <Text style={typography.tiny}>({Math.round((f.size ?? 0) / 1024)} KB)</Text>
            </Text>
          ))}
          <Pressable style={[styles.button, { marginTop: spacing.md }]} onPress={confirm} disabled={busy}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>{busy ? 'Uploading…' : 'Import these files'}</Text>
          </Pressable>
        </View>
      ) : null}

      {result ? (
        <View style={[styles.card, { marginTop: spacing.lg, borderLeftWidth: 3, borderLeftColor: colors.positive }]}>
          <Text style={typography.h3}>Imported</Text>
          {result.imported.map((i) => (
            <Text key={i.sha256} style={[typography.small, { marginTop: spacing.xs }]}>
              {i.fileName}: {i.rowsParsed} rows, {i.daysWithData} days with data
            </Text>
          ))}
          {result.skipped?.map((s) => (
            <Text key={s.fileName} style={[typography.tiny, { marginTop: spacing.xs }]}>
              Skipped {s.fileName}: {s.reason}
            </Text>
          ))}
          <Pressable style={[styles.button, { marginTop: spacing.md }]} onPress={() => navigation.navigate('Dashboard')}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Back to dashboard</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                             */
/* ------------------------------------------------------------------ */

export function InsightsScreen() {
  const month = monthForDate(today());
  const [insights, setInsights] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await container.loadInsights({ month });
    if (!res.ok) { setError(res.error.message); return; }
    setInsights(res.value);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const runAnalysis = useCallback(async () => {
    setBusy(true); setError(null);
    const res = await container.runAnalysis({ month, asOf: today() });
    setBusy(false);
    if (!res.ok) { setError(res.error.message); return; }
    setAnalysis(res.value);
    load();
  }, [month, load]);

  const setStatus = useCallback(async (id, status) => {
    const res = await container.updateInsightStatus({ id, status });
    if (res.ok) load();
  }, [load]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Insights</Text>
      <Text style={[typography.small, { marginTop: 4, marginBottom: spacing.lg }]}>
        Every claim is tied to a day you actually logged. Blank days cannot be cited.
      </Text>

      {error ? <Banner tone="negative">{error}</Banner> : null}

      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={runAnalysis} disabled={busy}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>{busy ? 'Analysing…' : 'Run analysis'}</Text>
      </Pressable>

      {analysis?.insufficient ? (
        <Banner tone="warning">
          {analysis.insufficient.message} Log a few more days and this will unlock.
        </Banner>
      ) : null}

      {analysis?.bundle?.rejected?.length ? (
        <Banner tone="warning">
          {analysis.bundle.rejected.length} claim(s) were dropped because they could not be tied to a
          real day. That filter is the point.
        </Banner>
      ) : null}

      {analysis?.bundle?.rejectedActions?.length ? (
        <Banner tone="warning">
          {analysis.bundle.rejectedActions.length} suggested action(s) broke a rule you stated and were
          removed.
        </Banner>
      ) : null}

      {analysis?.bundle?.actions?.length ? (
        <>
          <Text style={styles.sectionTitle}>Do this next</Text>
          {analysis.bundle.actions.map((a, i) => (
            <View key={i} style={styles.card}>
              <Text style={typography.h3}>{a.action}</Text>
              <Text style={[typography.small, { marginTop: 2 }]}>{a.why}</Text>
              <Text style={[typography.small, { marginTop: spacing.xs, color: colors.primary }]}>
                {a.firstStep} · {a.timeBox}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {insights && insights.length === 0 && !analysis ? (
        <EmptyState title="No insights yet" message="Run an analysis to see patterns across your month." />
      ) : null}

      {insights && insights.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Findings</Text>
          {sortBySeverity(insights).map((i) => (
            <InsightCard key={i._id} insight={i} onStatus={setStatus} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export function SettingsScreen() {
  const [health, setHealth] = useState(null);
  const [sheets, setSheets] = useState(null);

  const refresh = useCallback(async () => {
    setHealth((await container.api.health()).value ?? null);
    setSheets((await container.api.getSheetsStatus()).value ?? null);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const sync = useCallback(async (dryRun) => {
    const res = await container.api.syncSheets(monthForDate(today()), { dryRun });
    setSheets({ ...(sheets ?? {}), lastSync: res.ok ? res.value.totals : { error: res.error.message } });
  }, [sheets]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Settings</Text>

      <Text style={styles.sectionTitle}>Connection</Text>
      <View style={styles.card}>
        <Text style={typography.tiny}>SERVER</Text>
        <Text style={typography.mono}>{container.api.baseUrl}</Text>
        <View style={styles.divider} />
        <Text style={typography.small}>
          {health ? `Mongo: ${health.mongo} · OpenRouter: ${health.aiConfigured ? 'yes' : 'no'}` : 'Not reachable'}
        </Text>
        {health && !health.mongo ? (
          <Text style={[typography.small, { color: colors.warning, marginTop: 4 }]}>
            Mongo is down. Start it with: mongod --dbpath ~/tracker-mongo-data
          </Text>
        ) : null}
      </View>

      <Text style={styles.sectionTitle}>Google Sheets</Text>
      <View style={styles.card}>
        <Text style={typography.small}>
          {sheets?.connected ? `Connected: ${sheets.url}` : 'Not connected'}
        </Text>
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Pressable style={[styles.button, { flex: 1, marginRight: spacing.sm, paddingVertical: spacing.sm }]} onPress={() => sync(true)}>
            <Text style={{ color: '#fff', fontSize: 13 }}>Preview sync</Text>
          </Pressable>
          <Pressable style={[styles.button, { flex: 1, paddingVertical: spacing.sm }]} onPress={() => sync(false)}>
            <Text style={{ color: '#fff', fontSize: 13 }}>Sync now</Text>
          </Pressable>
        </View>
        {sheets?.lastSync ? (
          <Text style={[typography.small, { marginTop: spacing.sm }]}>
            {JSON.stringify(sheets.lastSync)}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}