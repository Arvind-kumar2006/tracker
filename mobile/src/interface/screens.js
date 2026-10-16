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
  buildDashboardView, monthForDate, formatDate, formatHours, formatPercent,
  formatMinutes,
} from '../domain/index.js';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { Button, StatCard, MonthGrid, CategoryBar, InsightCard, EmptyState, Banner, Chip, TaskCard, ProgressBar, SectionHeader, LoadingState, StatusPill } from './components.js';

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Dashboard                                                            */
/* ------------------------------------------------------------------ */

export function DashboardScreen({ navigation }) {
  const month = monthForDate(today());
  const [state, setState] = useState({ loading: true, error: null, view: null, todayEntry: null, insights: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const [res, dayRes, insightRes] = await Promise.all([
      container.loadDashboard({ month, asOf: today() }),
      container.loadDay(today()),
      container.loadInsights({ month }),
    ]);
    if (!res.ok) {
      setState({ loading: false, error: res.error.message, view: null, todayEntry: null, insights: [] });
      return;
    }
    setState({
      loading: false,
      error: null,
      view: buildDashboardView({ month, metrics: res.value.metrics, entries: res.value.entries, asOf: today() }),
      todayEntry: dayRes.ok ? dayRes.value : null,
      insights: insightRes.ok ? insightRes.value : [],
    });
  }, [month]);

  useEffect(() => { load(); }, [load]);

  if (state.loading) {
    return <LoadingState label="Loading your day…" />;
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
  const planItems = state.todayEntry?.plan?.items ?? [];
  const plannedMinutes = planItems.reduce((sum, item) => sum + Number(item.estimatedMinutes ?? 0), 0);
  const actualMinutes = planItems.reduce((sum, item) => sum + Number(item.actualMinutes ?? 0), 0);
  const todayProgress = plannedMinutes > 0 ? actualMinutes / plannedMinutes : 0;
  const openInsight = state.insights.find((insight) => insight.status !== 'DISMISSED');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={state.loading} onRefresh={load} tintColor={colors.primarySoft} />}
    >
      <View style={styles.heroCard}>
        <Text style={typography.tiny}>YOUR STUDY SPACE</Text>
        <Text style={[typography.display, { marginTop: spacing.xs }]}>{greeting}</Text>
        <Text style={[typography.small, { color: '#C8C2FF', marginTop: 2 }]}>{formatDate(today())}</Text>
        <View style={{ marginTop: spacing.xl }}>
          <ProgressBar
            value={todayProgress}
            label="Today’s focus"
            detail={plannedMinutes ? `${formatMinutes(actualMinutes)} of ${formatMinutes(plannedMinutes)}` : 'No plan yet'}
            tone={todayProgress >= 1 ? 'positive' : 'primary'}
          />
        </View>
        <View style={[styles.row, { marginTop: spacing.lg }]}>
          <Button label={planItems.length ? 'Open plan' : 'Plan your day'} onPress={() => navigation.navigate('DailyPlan', { date: today() })} style={{ flex: 1, marginRight: spacing.sm }} />
          <Button label="Reflect" variant="secondary" onPress={() => navigation.navigate('Reflection', { date: today() })} style={{ flex: 1 }} />
        </View>
      </View>

      <SectionHeader title="Today’s priorities" action={planItems.length ? 'See plan' : undefined} onAction={() => navigation.navigate('DailyPlan', { date: today() })} />
      {planItems.length ? planItems.map((item) => (
        <TaskCard
          key={item.id}
          item={item}
          compact
          onStart={() => navigation.navigate('FocusSession', { date: today(), itemId: item.id, itemText: item.text, estimatedMinutes: item.estimatedMinutes })}
        />
      )) : (
        <EmptyState
          icon="＋"
          title="Give today a shape"
          message="Choose one to three priorities, then start a focus session when you’re ready."
          action="Create today’s plan"
          onAction={() => navigation.navigate('DailyPlan', { date: today() })}
        />
      )}

      {planItems.length ? (
        <View style={[styles.card, { padding: spacing.md }]}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={typography.h3}>{actualMinutes > 0 ? 'Nice momentum' : 'Ready when you are'}</Text>
              <Text style={[typography.small, { marginTop: 2 }]}>{actualMinutes > 0 ? `${formatMinutes(actualMinutes)} focused so far today.` : 'Start with the smallest clear next step.'}</Text>
            </View>
            <StatusPill label={actualMinutes > 0 ? 'IN MOTION' : 'READY'} tone={actualMinutes > 0 ? 'positive' : 'neutral'} />
          </View>
        </View>
      ) : null}

      <SectionHeader title="This month" />
      <View style={styles.wrap}>
        <StatCard label="Hours" value={formatHours(v.hoursTotal)} sub={`${formatHours(v.hoursAvg)}/day`} />
        <StatCard label="Consistency" value={formatPercent(v.consistencyRate)} sub={`${Math.round(loggedShare)}% of elapsed`} tone="positive" />
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

      <SectionHeader title="Month at a glance" />
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

      <SectionHeader title="Where the time went" />
      <View style={styles.card}>
        <CategoryBar split={v.categorySplit} />
      </View>

      <SectionHeader title="Accountability note" />
      {openInsight ? (
        <InsightCard insight={openInsight} />
      ) : (
        <EmptyState title="No insight yet" message="Insights appear after you have enough recorded history to support a useful pattern." action="Open insights" onAction={() => navigation.navigate('Insights')} />
      )}

      <View style={[styles.row, { marginTop: spacing.sm }]}>
        <ActionTile label="Plan quality" onPress={() => navigation.navigate('PlanCritique')} />
        <ActionTile label="Settings" onPress={() => navigation.navigate('Settings')} />
      </View>
    </ScrollView>
  );
}

const ActionTile = ({ label, onPress }) => (
  <Pressable accessible accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.card, { flex: 1, marginRight: spacing.sm, padding: spacing.md, alignItems: 'center' }]}>
    <Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700', textAlign: 'center' }]}>{label}</Text>
  </Pressable>
);

/* ------------------------------------------------------------------ */
/* Focus home                                                          */
/* ------------------------------------------------------------------ */

export function FocusHomeScreen({ navigation, route }) {
  const date = route.params?.date ?? today();
  const [state, setState] = useState({ loading: true, error: null, entry: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    const res = await container.loadDay(date);
    if (!res.ok && res.error.status !== 404) {
      setState({ loading: false, error: res.error.message, entry: null });
      return;
    }
    setState({ loading: false, error: null, entry: res.ok ? res.value : null });
  }, [date]);

  useEffect(() => { load(); }, [load]);

  if (state.loading) return <LoadingState label="Loading today’s focus plan…" />;
  if (state.error) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyState title="Focus is unavailable" message={state.error} action="Retry" onAction={load} />
      </ScrollView>
    );
  }

  const items = state.entry?.plan?.items ?? [];
  const actual = items.reduce((sum, item) => sum + Number(item.actualMinutes ?? 0), 0);
  const estimated = items.reduce((sum, item) => sum + Number(item.estimatedMinutes ?? 0), 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Focus</Text>
      <Text style={[typography.small, { marginTop: spacing.xs }]}>{formatDate(date)} · choose one clear block</Text>

      <View style={[styles.heroCard, { marginTop: spacing.lg }]}>
        <Text style={typography.tiny}>TODAY’S FOCUS</Text>
        <Text style={[typography.h2, { marginTop: spacing.xs }]}>Small, uninterrupted progress</Text>
        <Text style={[typography.small, { color: '#C8C2FF', marginTop: spacing.xs }]}>
          {actual ? `${formatMinutes(actual)} focused so far` : 'Start with the priority that matters most.'}
        </Text>
        {estimated > 0 ? <View style={{ marginTop: spacing.lg }}><ProgressBar value={actual / estimated} label="Planned time" detail={`${formatMinutes(actual)} / ${formatMinutes(estimated)}`} /></View> : null}
      </View>

      {items.length ? items.map((item) => (
        <TaskCard
          key={item.id}
          item={item}
          onStart={() => navigation.navigate('FocusSession', { date, itemId: item.id, itemText: item.text, itemOutcome: item.outcome, estimatedMinutes: item.estimatedMinutes })}
        />
      )) : (
        <EmptyState
          icon="＋"
          title="No focus blocks yet"
          message="Create a daily plan first, then choose a priority here to begin."
          action="Open today’s plan"
          onAction={() => navigation.navigate('DailyPlan', { date })}
        />
      )}
    </ScrollView>
  );
}

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
  const [dashboard, setDashboard] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [insightRes, dashboardRes] = await Promise.all([
      container.loadInsights({ month }),
      container.loadDashboard({ month, asOf: today() }),
    ]);
    setLoading(false);
    if (!insightRes.ok && !dashboardRes.ok) {
      setError(insightRes.error.message);
      return;
    }
    setInsights(insightRes.ok ? insightRes.value : []);
    setDashboard(dashboardRes.ok ? dashboardRes.value : null);
    if (!insightRes.ok) setError(insightRes.error.message);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const runAnalysis = useCallback(async () => {
    setBusy(true); setError(null);
    const res = await container.runAnalysis({ month, asOf: today() });
    setBusy(false);
    if (!res.ok) { setError(res.error.message); return; }
    setAnalysis(res.value);
    await load();
  }, [month, load]);

  const setStatus = useCallback(async (id, status) => {
    const res = await container.updateInsightStatus({ id, status });
    if (res.ok) load();
  }, [load]);

  if (loading && !insights) return <LoadingState label="Loading your progress…" />;

  const entries = dashboard?.entries ?? [];
  const dailyMinutes = entries.map((entry) => ({
    date: entry.date,
    minutes: (entry.plan?.items ?? []).reduce((sum, item) => sum + Number(item.actualMinutes ?? 0), 0) || (Number(entry.totalHoursComputed ?? 0) * 60),
  })).slice(-7);
  const maxDailyMinutes = Math.max(1, ...dailyMinutes.map((day) => day.minutes));
  const plannedTasks = entries.reduce((sum, entry) => sum + (entry.plan?.items?.length ?? 0), 0);
  const completedTasks = entries.reduce((sum, entry) => sum + (entry.plan?.items ?? []).filter((item) => item.status === 'DONE' || Number(item.actualMinutes ?? 0) >= Number(item.estimatedMinutes ?? 0)).length, 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primarySoft} />}>
      <Text style={typography.h1}>Insights</Text>
      <Text style={[typography.small, { marginTop: 4, marginBottom: spacing.lg }]}>
        Every claim is tied to a day you actually logged. Blank days cannot be cited.
      </Text>

      {error ? <Banner tone="negative">{error}</Banner> : null}

      <Button label={busy ? 'Analysing…' : 'Run analysis'} onPress={runAnalysis} loading={busy} disabled={busy} />

      {dashboard ? (
        <>
          <SectionHeader title="This week" />
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={typography.h3}>{formatHours(dashboard.metrics?.hoursTotal)} logged this month</Text>
                <Text style={[typography.small, { marginTop: 2 }]}>{completedTasks} of {plannedTasks || '—'} planned priorities completed</Text>
              </View>
              <StatusPill label={formatPercent(dashboard.metrics?.consistencyRate)} tone="positive" />
            </View>
            <View style={[styles.row, { alignItems: 'flex-end', height: 100, marginTop: spacing.lg }]}>
              {dailyMinutes.length ? dailyMinutes.map((day) => (
                <View key={day.date} style={{ flex: 1, alignItems: 'center', marginHorizontal: 3 }}>
                  <View style={{ width: '100%', height: Math.max(4, (day.minutes / maxDailyMinutes) * 72), backgroundColor: day.minutes ? colors.primarySoft : colors.surfaceAlt, borderRadius: radius.sm }} />
                  <Text style={[typography.tiny, { marginTop: spacing.xs }]}>{day.date.slice(-2)}</Text>
                </View>
              )) : <Text style={typography.small}>No focused-time history yet.</Text>}
            </View>
            <Text style={[typography.tiny, { marginTop: spacing.sm }]}>Focused minutes from recorded plan sessions, not estimates.</Text>
          </View>
        </>
      ) : null}

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
          <SectionHeader title="Do this next" />
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
        <EmptyState title="No insights yet" message="Run an analysis to see patterns across your month." action="Try analysis" onAction={runAnalysis} />
      ) : null}

      {insights && insights.length > 0 ? (
        <>
          <SectionHeader title="Findings" />
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

export function SettingsScreen({ navigation }) {
  const [health, setHealth] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [healthRes, sheetsRes] = await Promise.all([container.api.health(), container.api.getSheetsStatus()]);
    setLoading(false);
    setHealth(healthRes.ok ? healthRes.value : null);
    setSheets(sheetsRes.ok ? sheetsRes.value : null);
    if (!healthRes.ok && !sheetsRes.ok) setError(healthRes.error.message);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const sync = useCallback(async (dryRun) => {
    setSyncing(true);
    const res = await container.api.syncSheets(monthForDate(today()), { dryRun });
    setSyncing(false);
    setSheets((current) => ({ ...(current ?? {}), lastSync: res.ok
      ? { status: dryRun ? 'preview' : 'synced', totals: res.value.totals }
      : { status: 'failed', error: res.error.message }, lastSyncAt: new Date().toISOString() }));
  }, []);

  if (loading && !health && !sheets) return <LoadingState label="Checking connections…" />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primarySoft} />}>
      <Text style={typography.h1}>Settings</Text>
      <Text style={[typography.small, { marginTop: spacing.xs }]}>Connections, sync, and migration tools.</Text>

      {error ? <Banner tone="negative">{error}</Banner> : null}

      <SectionHeader title="Connection" />
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={typography.tiny}>SERVER</Text>
          <StatusPill label={health?.status === 'ok' ? 'ONLINE' : 'CHECK CONNECTION'} tone={health?.status === 'ok' ? 'positive' : 'warning'} />
        </View>
        <Text style={typography.mono}>{container.api.baseUrl}</Text>
        <View style={styles.divider} />
        <Text style={typography.small}>
          {health ? `Database ${health.mongo === 'up' ? 'connected' : 'unavailable'} · AI ${health.aiConfigured ? 'configured' : 'not configured'}` : 'Not reachable'}
        </Text>
        {health && !health.mongo ? (
          <Text style={[typography.small, { color: colors.warning, marginTop: 4 }]}>
            Mongo is down. Start it with: mongod --dbpath ~/tracker-mongo-data
          </Text>
        ) : null}
      </View>

      <SectionHeader title="Google Sheets" />
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={typography.h3}>{sheets?.connected ? 'Connected' : 'Not connected'}</Text>
          <StatusPill label={sheets?.syncReady ? 'READY' : 'ACTION NEEDED'} tone={sheets?.syncReady ? 'positive' : 'warning'} />
        </View>
        <Text style={[typography.small, { marginTop: spacing.xs }]}>{sheets?.credentialError ?? (sheets?.connected ? 'Your records can be mirrored manually.' : 'Connect a sheet from the backend configuration.')}</Text>
        {sheets?.url ? <Text style={[typography.mono, { marginTop: spacing.sm }]} numberOfLines={2}>{sheets.url}</Text> : null}
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Button label="Preview" variant="secondary" onPress={() => sync(true)} loading={syncing} disabled={syncing} style={{ flex: 1, marginRight: spacing.sm }} />
          <Button label="Sync now" onPress={() => sync(false)} loading={syncing} disabled={syncing} style={{ flex: 1 }} />
        </View>
        {sheets?.lastSync ? (
          <Text
            style={[typography.small, {
              marginTop: spacing.sm,
              color: sheets.lastSync.status === 'failed' ? colors.negative : colors.textMuted,
            }]}
          >
            {sheets.lastSync.status === 'failed'
              ? `Sync failed: ${sheets.lastSync.error}`
              : `${sheets.lastSync.status === 'preview' ? 'Preview complete' : 'Sync complete'}${sheets.lastSync.totals ? ` · ${sheets.lastSync.totals.rows ?? 0} rows` : ''}`}
          </Text>
        ) : null}
      </View>

      <SectionHeader title="Migration" />
      <View style={styles.card}>
        <Text style={typography.h3}>Historical workbook import</Text>
        <Text style={[typography.small, { marginTop: spacing.xs }]}>Use this only for backfilling an existing tracker. New daily records should start from Plan.</Text>
        <Button label="Open import" variant="secondary" onPress={() => navigation.navigate('Import')} style={{ marginTop: spacing.md }} />
      </View>
    </ScrollView>
  );
}
