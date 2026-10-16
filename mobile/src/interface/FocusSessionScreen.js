import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { container } from '../shared/container.js';
import { formatDate, formatMinutes } from '../domain/index.js';
import { colors, typography, styles, spacing } from './theme.js';
import { Banner, Button, ProgressBar, StatusPill } from './components.js';

const clock = (seconds) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
};

const today = () => new Date().toISOString().slice(0, 10);

/** A timestamp-based timer: elapsed time remains correct while the app is backgrounded. */
export function FocusSessionScreen({ route, navigation }) {
  const {
    date = today(), itemId, itemText, itemOutcome, estimatedMinutes,
  } = route.params ?? {};
  const [mode, setMode] = useState('focus');
  const [focusTarget, setFocusTarget] = useState(50);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [interrupted, setInterrupted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const runningRef = useRef(false);
  const runStartedAtRef = useRef(null);
  const accumulatedRef = useRef(0);
  const elapsedRef = useRef(0);
  const allowLeaveRef = useRef(false);
  const sessionIdRef = useRef(route.params?.sessionId ?? `focus-${date}-${itemId ?? 'priority'}-${Date.now()}`);

  const syncClock = useCallback(() => {
    if (!runningRef.current || !runStartedAtRef.current) return elapsedRef.current;
    const next = accumulatedRef.current + Math.max(0, Math.floor((Date.now() - runStartedAtRef.current) / 1000));
    elapsedRef.current = next;
    setElapsed(next);
    return next;
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(syncClock, 500);
    return () => clearInterval(timer);
  }, [running, syncClock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncClock();
    });
    return () => subscription.remove();
  }, [syncClock]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowLeaveRef.current || saved || elapsedRef.current < 1) return;
      event.preventDefault();
      Alert.alert('Leave this session?', 'Your unfinished focus time will not be added yet.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => { allowLeaveRef.current = true; navigation.dispatch(event.data.action); } },
      ]);
    });
    return unsubscribe;
  }, [navigation, saved]);

  const pause = useCallback(() => {
    const current = syncClock();
    accumulatedRef.current = current;
    runStartedAtRef.current = null;
    runningRef.current = false;
    setRunning(false);
  }, [syncClock]);

  const start = useCallback(() => {
    if (saving || saved || running) return;
    if (mode === 'focus' && !startedAt) setStartedAt(new Date().toISOString());
    accumulatedRef.current = elapsedRef.current;
    runStartedAtRef.current = Date.now();
    runningRef.current = true;
    setMessage(null);
    setRunning(true);
  }, [mode, running, saving, saved, startedAt]);

  const toggle = useCallback(() => {
    if (running) pause();
    else start();
  }, [pause, running, start]);

  const chooseFocusTarget = useCallback((minutes) => {
    if (running || elapsed > 0 || mode !== 'focus') return;
    setFocusTarget(minutes);
  }, [elapsed, mode, running]);

  const beginBreak = useCallback(() => {
    if (running || elapsed > 0 || saved) return;
    setMode('break');
    setMessage(null);
    setError(null);
  }, [elapsed, running, saved]);

  const finish = useCallback(async () => {
    const finalElapsed = syncClock();
    if (finalElapsed < 1 || saving || saved) return;
    pause();
    if (mode === 'break') {
      accumulatedRef.current = 0;
      elapsedRef.current = 0;
      setElapsed(0);
      setMode('focus');
      setMessage('Break complete. Your next focus block is ready.');
      return;
    }

    setSaving(true);
    setError(null);
    const res = await container.saveFocusSession(date, {
      id: sessionIdRef.current,
      itemId,
      durationMinutes: Math.max(1, Math.round(finalElapsed / 60)),
      startedAt: startedAt ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
      interrupted,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setSaved(true);
    setMessage(`Added ${formatMinutes(Math.max(1, Math.round(finalElapsed / 60)))} to this priority.`);
  }, [date, interrupted, itemId, mode, pause, saved, saving, startedAt, syncClock]);

  const targetSeconds = mode === 'break' ? 10 * 60 : focusTarget * 60;
  const targetLabel = mode === 'break' ? '10 minute break' : `${focusTarget} minute focus`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>{mode === 'break' ? 'Take a break' : 'Focus session'}</Text>
      <Text style={[typography.small, { marginTop: spacing.xs }]}>{formatDate(date)} · {mode === 'break' ? 'reset before the next block' : 'one uninterrupted block'}</Text>

      <View style={[styles.heroCard, { marginTop: spacing.lg, alignItems: 'center' }]}>
        <View style={styles.rowBetween}>
          <StatusPill label={mode === 'break' ? 'BREAK' : running ? 'IN FOCUS' : 'READY'} tone={mode === 'break' ? 'warning' : running ? 'positive' : 'neutral'} />
          <Text style={[typography.tiny, { color: '#C8C2FF' }]}>{targetLabel}</Text>
        </View>
        <Text style={[typography.h2, { marginTop: spacing.lg, textAlign: 'center' }]}>{itemText || 'Selected priority'}</Text>
        {itemOutcome ? <Text style={[typography.small, { marginTop: spacing.xs, textAlign: 'center' }]}>{itemOutcome}</Text> : null}
        <Text style={[typography.display, { fontSize: 52, marginTop: spacing.lg }]}>{clock(elapsed)}</Text>
        <Text style={[typography.small, { marginTop: spacing.xs }]}>{mode === 'break' ? 'Rest is part of the plan.' : `Estimated task time: ${estimatedMinutes ?? '—'} minutes`}</Text>
        <View style={{ width: '100%', marginTop: spacing.lg }}>
          <ProgressBar value={elapsed / targetSeconds} label="Block progress" detail={`${Math.min(100, Math.round((elapsed / targetSeconds) * 100))}%`} tone={mode === 'break' ? 'warning' : 'positive'} />
        </View>

        {mode === 'focus' && !running && elapsed === 0 ? (
          <View style={[styles.row, { marginTop: spacing.lg }]}>
            {[25, 50].map((minutes) => (
              <Pressable key={minutes} accessible accessibilityRole="button" accessibilityLabel={`${minutes} minute focus`} accessibilityState={{ selected: focusTarget === minutes }} onPress={() => chooseFocusTarget(minutes)} style={[styles.chip, { flex: 1, marginRight: minutes === 25 ? spacing.sm : 0, alignItems: 'center' }, focusTarget === minutes && { borderColor: colors.primarySoft, backgroundColor: colors.primaryTint }]}>
                <Text style={typography.small}>{minutes} min</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Button label={running ? 'Pause' : elapsed ? 'Resume' : mode === 'break' ? 'Start break' : 'Start focus'} onPress={toggle} loading={saving} disabled={saving || saved} style={{ width: '100%', marginTop: spacing.lg }} />
        <Button label={mode === 'break' ? 'Finish break' : saved ? 'Session saved' : 'Finish session'} variant="secondary" onPress={finish} disabled={saving || elapsed < 1 || saved} style={{ width: '100%', marginTop: spacing.sm }} />
      </View>

      {mode === 'focus' && !running && elapsed === 0 && !saved ? <Button label="Take a 10-minute break" variant="ghost" onPress={beginBreak} /> : null}
      {mode === 'focus' && !saved ? <Button label={interrupted ? 'Interruption recorded' : 'Mark interruption'} variant="secondary" onPress={() => setInterrupted((value) => !value)} disabled={saving} style={{ marginTop: spacing.sm }} /> : null}
      {error ? <Banner tone="negative">{error}</Banner> : null}
      {message ? <Banner tone={saved ? 'positive' : 'neutral'}>{message}</Banner> : null}

      <Button label="Back to focus list" variant="ghost" onPress={() => navigation.goBack()} style={{ marginTop: spacing.md }} />
    </ScrollView>
  );
}
