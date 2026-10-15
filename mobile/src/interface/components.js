import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { colors, typography, styles, radius, spacing, toneColor } from './theme.js';
import { formatDate, TONE_COLORS, describeBuildOutcome } from '../domain/index.js';

const Chip = ({ label, tone = 'neutral', style }) => (
  <View style={[styles.chip, { borderColor: toneColor(tone) }, style]}>
    <Text style={[typography.tiny, { color: toneColor(tone) }]}>{label}</Text>
  </View>
);

export const StatCard = ({ label, value, sub, tone = 'neutral' }) => (
  <View
    style={[
      styles.card,
      { flex: 1, minWidth: 150, marginRight: spacing.sm, marginBottom: spacing.sm, padding: spacing.md },
    ]}
  >
    <Text style={typography.tiny}>{label.toUpperCase()}</Text>
    <Text style={{ ...typography.h1, marginTop: 2 }}>{value}</Text>
    {sub ? <Text style={[typography.tiny, { marginTop: 2 }]}>{sub}</Text> : null}
  </View>
);

/**
 * Month calendar.
 *
 * The important behaviour is the blank-day treatment: an unlogged day is muted and reads "—",
 * never a red failure. Showing 26 red squares for a month you stopped logging would train you
 * to stop opening the app.
 */
export const MonthGrid = ({ days }) => (
  <View>
    <View style={[styles.row, { marginBottom: spacing.xs, paddingHorizontal: 2 }]}>
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
        <Text key={i} style={[typography.tiny, { flex: 1, textAlign: 'center' }]}>
          {d}
        </Text>
      ))}
    </View>
    <View style={styles.wrap}>
      {days.map((day, i) => {
        if (!day) return <View key={`pad-${i}`} style={{ width: '14.28%', height: 46 }} />;
        const color = TONE_COLORS[day.status?.tone] ?? colors.neutral;
        return (
          <View key={day.date} style={{ width: '14.28%', padding: 2, alignItems: 'center' }}>
            <View
              accessible
              accessibilityLabel={`${formatDate(day.date)} — ${day.status?.label ?? 'no data'}`}
              style={{
                width: 38,
                height: 38,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: day.isFuture ? 'transparent' : day.hasData ? colors.surfaceAlt : 'transparent',
                borderWidth: day.hasData ? 1.5 : 1,
                borderColor: day.hasData ? color : colors.border,
                opacity: day.isFuture ? 0.35 : 1,
              }}
            >
              <Text style={{ ...typography.small, color: day.hasData ? color : colors.textMuted }}>
                {day.date.slice(-2)}
              </Text>
              {day.hasData ? <Text style={{ fontSize: 9, color }}>{day.status?.icon}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  </View>
);

export const CategoryBar = ({ split }) => {
  if (!split) return null;
  const entries = Object.entries(split).filter(([, v]) => v > 0);
  if (entries.length === 0) return <Text style={typography.small}>No time recorded yet.</Text>;

  return (
    <View>
      <View style={[styles.row, { height: 10, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceAlt }]}>
        {entries.map(([k, v]) => (
          <View key={k} style={{ flex: v, backgroundColor: categoryColor(k) }} />
        ))}
      </View>
      <View style={[styles.wrap, { marginTop: spacing.sm }]}>
        {entries.map(([k, v]) => (
          <Chip key={k} label={`${categoryLabel(k)} ${Math.round(v)}%`} />
        ))}
      </View>
    </View>
  );
};

const categoryLabel = (k) =>
  ({ genaiMinutes: 'GenAI', codingMinutes: 'Coding', englishMinutes: 'English', otherMinutes: 'Other' })[k] ?? k;

const categoryColor = (k) =>
  ({ genaiMinutes: '#6C5CE7', codingMinutes: '#00B894', englishMinutes: '#FDCB6E', otherMinutes: '#74B9FF' })[k] ??
  colors.neutral;

export const InsightCard = ({ insight, onStatus, testID }) => {
  const tone = TONE_COLORS[insight.severity === 'HIGH' ? 'negative' : insight.severity === 'MEDIUM' ? 'warning' : 'neutral'];
  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: tone }]} testID={testID}>
      <View style={styles.rowBetween}>
        <Text style={[typography.tiny, { color: tone, letterSpacing: 0.5 }]}>
          {insight.section} · {insight.severity}
        </Text>
        <Chip label={insight.status ?? 'OPEN'} tone={insight.status === 'DISMISSED' ? 'neutral' : 'positive'} />
      </View>

      <Text style={[typography.h3, { marginTop: spacing.xs }]}>{insight.title}</Text>
      <Text style={[typography.body, { marginTop: spacing.xs, lineHeight: 20 }]}>{insight.body}</Text>

      {insight.evidenceQuotes?.length ? (
        <View style={{ marginTop: spacing.md, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }}>
          {insight.evidenceQuotes.slice(0, 2).map((q, i) => (
            <Text key={i} style={[typography.small, { fontStyle: 'italic', marginBottom: 2 }]}>
              “{q}”
              {insight.evidenceDates?.[i] ? <Text style={typography.tiny}> — {insight.evidenceDates[i]}</Text> : null}
            </Text>
          ))}
        </View>
      ) : null}

      {insight.action ? (
        <Text style={[typography.small, { marginTop: spacing.md, color: colors.primary }]}>→ {insight.action}</Text>
      ) : null}

      {onStatus && insight.status !== 'DISMISSED' ? (
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Pressable onPress={() => onStatus(insight._id, 'ACTED_ON')} style={[styles.button, { flex: 1, marginRight: spacing.sm, paddingVertical: spacing.sm }]}>
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Acted on</Text>
          </Pressable>
          <Pressable
            onPress={() => onStatus(insight._id, 'DISMISSED')}
            style={[styles.button, styles.buttonSecondary, { flex: 1, paddingVertical: spacing.sm }]}
          >
            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

export const EmptyState = ({ title, message, action, onAction }) => (
  <View style={[styles.card, { alignItems: 'center', paddingVertical: spacing.xl }]}>
    <Text style={[typography.h3, { textAlign: 'center' }]}>{title}</Text>
    {message ? (
      <Text style={[typography.small, { textAlign: 'center', marginTop: spacing.sm, lineHeight: 19 }]}>{message}</Text>
    ) : null}
    {action ? (
      <Pressable onPress={onAction} style={[styles.button, { marginTop: spacing.lg, paddingHorizontal: spacing.xl }]}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>{action}</Text>
      </Pressable>
    ) : null}
  </View>
);

export const Banner = ({ tone = 'neutral', children }) => (
  <View
    style={{
      backgroundColor: colors.surfaceAlt,
      borderLeftWidth: 3,
      borderLeftColor: toneColor(tone),
      borderRadius: radius.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
    }}
  >
    <Text style={typography.small}>{children}</Text>
  </View>
);

export { Chip, describeBuildOutcome };