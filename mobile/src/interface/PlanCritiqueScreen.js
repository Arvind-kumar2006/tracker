import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { container } from '../shared/container.js';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { Banner, EmptyState, Chip, LoadingState, Button } from './components.js';
import { formatDate } from '../domain/index.js';
import {
  AXES, AXIS_ORDER, BAND_COLOR, BAND_LABEL, band, critiqueStats, critiqueSummary,
  expandBlocks, overallBand, sortCritiques,
} from '../domain/planCritique.js';

/* ------------------------------------------------------------------ */

const AxisBar = ({ axisKey, score }) => {
  const meta = AXES[axisKey];
  const b = band(Number(score ?? 0));
  return (
    <View style={{ marginBottom: spacing.md }}>
      <View style={styles.rowBetween}>
        <Text style={typography.small}>{meta.label}</Text>
        <Text style={[typography.small, { color: BAND_COLOR[b], fontWeight: '600' }]}>
          {score ?? '—'}/10 · {BAND_LABEL[b]}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, marginTop: 4 }}>
        <View style={{ width: `${Math.max(0, Math.min(10, Number(score ?? 0))) * 10}%`, height: '100%', borderRadius: 3, backgroundColor: BAND_COLOR[b] }} />
      </View>
      <Text style={[typography.tiny, { marginTop: 3 }]}>{meta.question}</Text>
    </View>
  );
};

const BlockRow = ({ block }) => (
  <View style={[styles.rowBetween, { marginBottom: spacing.xs }]}>
    <Text style={[typography.small, { color: colors.primary, width: 108 }]}>
      {block.start}{block.end ? ` – ${block.end}` : ''}
    </Text>
    <Text style={[typography.small, { flex: 1, textAlign: 'right' }]}>
      {block.label} <Text style={typography.tiny}>({block.durationMin}m)</Text>
    </Text>
  </View>
);

const CritiqueCard = ({ critique }) => {
  const b = overallBand(critique.overall);
  const blocks = expandBlocks(critique.rewrittenBlocks);
  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: BAND_COLOR[b] }]}>
      <View style={styles.rowBetween}>
        <Text style={typography.h3}>{formatDate(critique.date)}</Text>
        <Chip label={`${critique.overall ?? '—'}/10 ${BAND_LABEL[b]}`} tone={b} />
      </View>

      <Text style={[typography.small, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
        {critiqueSummary(critique)}
      </Text>

      {AXIS_ORDER.map((k) => (
        <AxisBar key={k} axisKey={k} score={critique.axes?.[k]?.score} />
      ))}

      {critique.issues?.length ? (
        <>
          <Text style={[typography.tiny, { marginTop: spacing.sm }]}>WHAT\'S WRONG</Text>
          {critique.issues.map((issue, i) => (
            <Text key={i} style={[typography.small, { marginTop: 2 }]}>• {issue}</Text>
          ))}
        </>
      ) : null}

      {blocks.length ? (
        <>
          <Text style={[typography.tiny, { marginTop: spacing.md }]}>REWRITTEN PLAN</Text>
          {blocks.map((blk, i) => (
            <BlockRow key={i} block={blk} />
          ))}
        </>
      ) : null}

      {critique.summary ? (
        <Text style={[typography.small, { marginTop: spacing.md, fontStyle: 'italic' }]}>
          {critique.summary}
        </Text>
      ) : null}
    </View>
  );
};

/* ------------------------------------------------------------------ */

export function PlanCritiqueScreen() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await container.loadPlanCritiques();
    if (!res.ok) { setError(res.error.message); return; }
    setRows(res.value);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runAnalysis = useCallback(async () => {
    setBusy(true);
    const res = await container.runAnalysis({ month: new Date().toISOString().slice(0, 7), asOf: new Date().toISOString().slice(0, 10) });
    setBusy(false);
    if (!res.ok) { setError(res.error.message); return; }
    load();
  }, [load]);

  const stats = useMemo(() => critiqueStats(rows ?? []), [rows]);
  const sorted = useMemo(() => sortCritiques(rows ?? []), [rows]);

  if (rows === null && !error) return <LoadingState label="Loading plan quality…" />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <Text style={typography.h1}>Plan quality</Text>
      <Text style={[typography.small, { marginTop: 4, marginBottom: spacing.lg }]}>
        How well the plans you write survive contact with the week.
      </Text>

      {error ? <Banner tone="negative">{error}</Banner> : null}

      {error && rows === null ? <Button label="Retry" variant="secondary" onPress={load} /> : null}

      {rows && rows.length === 0 ? (
        <EmptyState
          title="No plan critiques yet"
          message="Critiques are produced during analysis. Run one and they will appear here."
          action={busy ? 'Analysing…' : 'Run analysis'}
          onAction={runAnalysis}
        />
      ) : null}

      {stats.days > 0 ? (
        <View style={styles.card}>
          <Text style={typography.tiny}>ACROSS {stats.days} DAY(S)</Text>
          <Text style={[typography.h1, { marginTop: 2 }]}>{stats.overallAvg}/10 average</Text>

          <View style={styles.divider} />

          <View style={styles.wrap}>
            {AXIS_ORDER.map((k) =>
              stats.byAxis[k] === null ? null : (
                <Chip key={k} label={`${AXES[k].label} ${stats.byAxis[k]}`} tone={band(stats.byAxis[k])} />
              )
            )}
          </View>

          {stats.weakestAxis ? (
            <Banner tone={band(stats.byAxis[stats.weakestAxis]) === 'weak' ? 'negative' : 'warning'}>
              Weakest axis: <Text style={{ fontWeight: '600' }}>{AXES[stats.weakestAxis].label}</Text>.
              {' '}
              {stats.byAxis[stats.weakestAxis] < 7
                ? AXES[stats.weakestAxis].lowMeans
                : AXES[stats.weakestAxis].highMeans}
            </Banner>
          ) : null}

          {stats.biggestGap ? (
            <Banner tone="warning">
              {stats.biggestGap.date}: {stats.biggestGap.text}
            </Banner>
          ) : null}
        </View>
      ) : null}

      {sorted.map((c) => (
        <CritiqueCard key={c.date} critique={c} />
      ))}
    </ScrollView>
  );
}
