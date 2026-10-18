import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '../shared/container.js';
import { formatDate } from '../domain/index.js';
import { MAX_DAILY_PRIORITIES, WORK_TYPES, durationBetween, normaliseTime } from '../domain/dailyPlan.js';
import { colors, typography, styles, spacing, radius } from './theme.js';
import { Banner, Button, LoadingState } from './components.js';

const STATUS_OPTIONS = [
  { value: 'DONE', label: 'Done' },
  { value: 'PARTIAL', label: 'Partly' },
  { value: 'MOVED', label: 'Moved to buffer' },
];

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const dateForMode = (mode) => {
  const date = new Date(`${today()}T12:00:00`);
  if (mode === 'tomorrow') date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const TIME_OPTIONS = Array.from({ length: 288 }, (_, index) => {
  const minutes = index * 5;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

const timeToMinutes = (value) => {
  const time = normaliseTime(value);
  return time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : Number.POSITIVE_INFINITY;
};

const addMinutes = (value, amount) => {
  const start = timeToMinutes(value);
  if (!Number.isFinite(start)) return '';
  const total = (start + amount) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const formatTime = (value) => {
  const time = normaliseTime(value);
  if (!time) return 'Choose time';
  const hours = Number(time.slice(0, 2));
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${time.slice(3)} ${suffix}`;
};

const formatDuration = (minutes) => {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${hours}h ${remainder}m`;
};

const nextRoundTime = () => {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil((current + 1) / 30) * 30;
  return `${String(Math.floor((rounded % 1440) / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};

const normaliseStatus = (value) => {
  const candidate = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (candidate === 'PARTLY') return 'PARTIAL';
  if (candidate === 'MOVED_TO_BUFFER') return 'MOVED';
  return ['DONE', 'PARTIAL', 'MOVED'].includes(candidate) ? candidate : 'PLANNED';
};

const blockMinutes = (block) => Number(block.minutes) || durationBetween(block.start, block.end) || 0;

const sortBlocks = (blocks) => [...blocks].sort((a, b) => {
  const startDifference = timeToMinutes(a.start) - timeToMinutes(b.start);
  return startDifference || String(a.task ?? '').localeCompare(String(b.task ?? ''));
});

const blockFromItem = (item, date, index) => {
  const task = item.task ?? item.text ?? '';
  const doneWhen = item.doneWhen ?? item.outcome ?? '';
  const type = WORK_TYPES.includes(item.type ?? item.workType) ? (item.type ?? item.workType) : 'Other';
  const start = normaliseTime(item.start ?? item.startTime);
  const end = normaliseTime(item.end ?? item.endTime);
  return {
    id: item.id ?? `${date}-${index + 1}`,
    date,
    task,
    doneWhen,
    type,
    start,
    end,
    minutes: Number(item.minutes ?? item.estimatedMinutes) || durationBetween(start, end),
    isMust: Boolean(item.isMust ?? item.priority === 'HIGH'),
    status: normaliseStatus(item.status),
  };
};

const normaliseBlocks = (items, date) => {
  const blocks = sortBlocks((items ?? []).slice(0, MAX_DAILY_PRIORITIES).map((item, index) => blockFromItem(item, date, index)));
  let mustAssigned = false;
  const normalised = blocks.map((block) => {
    const isMust = block.isMust && !mustAssigned;
    if (isMust) mustAssigned = true;
    return { ...block, isMust };
  });
  if (normalised.length && !mustAssigned) normalised[0].isMust = true;
  return normalised;
};

const freshBlock = (date, index = 0, isMust = false) => {
  const start = nextRoundTime();
  const end = addMinutes(start, 50);
  return {
    id: `new-${date}-${index + 1}`,
    date,
    task: '',
    doneWhen: '',
    type: 'Other',
    start,
    end,
    minutes: 50,
    isMust,
    status: 'PLANNED',
  };
};

const blocksToPayload = (blocks, date, budget) => ({
  items: blocks.map((block) => ({
    id: block.id,
    date,
    task: block.task,
    text: block.task,
    doneWhen: block.doneWhen,
    outcome: block.doneWhen,
    type: block.type,
    workType: block.type,
    start: block.start,
    startTime: block.start,
    end: block.end,
    endTime: block.end,
    minutes: block.minutes,
    estimatedMinutes: block.minutes,
    isMust: block.isMust,
    priority: block.isMust ? 'HIGH' : 'MEDIUM',
    status: block.status,
  })),
  availableMinutes: budget,
  idealMinutes: budget,
});

const interval = (block) => {
  const start = timeToMinutes(block.start);
  let end = timeToMinutes(block.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) end += 1440;
  return { start, end };
};

const overlaps = (first, second) => {
  const a = interval(first);
  const b = interval(second);
  return Boolean(a && b && a.start < b.end && b.start < a.end);
};

const lateStop = (block) => {
  const range = interval(block);
  return Boolean(range && range.end > 23 * 60 + 30);
};

const SelectorModal = ({ kind, value, onClose, onSelect }) => {
  if (!kind) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <View style={styles.rowBetween}>
            <Text style={typography.h3}>Choose {kind} time</Text>
            <Pressable accessible accessibilityRole="button" accessibilityLabel="Close time selector" onPress={onClose} hitSlop={8}>
              <Text style={[typography.h2, { color: colors.textMuted }]}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingTop: spacing.sm }}>
            {TIME_OPTIONS.map((option) => (
              <Pressable
                key={option}
                accessible
                accessibilityRole="button"
                accessibilityLabel={formatTime(option)}
                accessibilityState={{ selected: option === value }}
                onPress={() => onSelect(option)}
                style={[modalStyles.option, option === value && { backgroundColor: colors.primaryTint, borderColor: colors.primary }]}
              >
                <Text style={[typography.body, option === value && { color: colors.primarySoft, fontWeight: '700' }]}>{formatTime(option)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const Field = ({ value, onChangeText, placeholder, accessibilityLabel }) => (
  <TextInput
    accessible
    accessibilityLabel={accessibilityLabel ?? placeholder}
    value={String(value ?? '')}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={colors.textMuted}
    style={[styles.input, { minHeight: 48 }]}
  />
);

const TimeSelector = ({ label, value, onPress, style }) => (
  <View style={[{ flex: 1 }, style]}>
    <Text style={typography.tiny}>{label.toUpperCase()}</Text>
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatTime(value)}`}
      onPress={onPress}
      style={[styles.input, { marginTop: spacing.xs, justifyContent: 'center' }]}
    >
      <Text style={typography.body}>{formatTime(value)}</Text>
    </Pressable>
  </View>
);

export function SimplePlanScreen({ navigation }) {
  const [dayMode, setDayMode] = useState('today');
  const date = dateForMode(dayMode);
  const [blocks, setBlocks] = useState([]);
  const [draft, setDraft] = useState(() => freshBlock(date, 0, true));
  const [editingId, setEditingId] = useState(null);
  const [budget, setBudget] = useState('150');
  const [picker, setPicker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    setEditingId(null);
    const res = await container.loadDay(date);
    setLoading(false);
    if (res.ok) {
      const loaded = normaliseBlocks(res.value.plan?.items, date);
      setBlocks(loaded);
      setBudget(String(Number(res.value.plan?.availableMinutes) || 150));
      setDraft(freshBlock(date, loaded.length, !loaded.some((block) => block.isMust)));
      return;
    }
    if (res.error.status === 404) {
      setBlocks([]);
      setBudget('150');
      setDraft(freshBlock(date, 0, true));
      return;
    }
    setError(res.error.message);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const updateDraft = useCallback((key, value) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const persist = useCallback(async (nextBlocks, nextBudget = budget) => {
    const normalised = normaliseBlocks(nextBlocks, date);
    setSaving(true);
    setError(null);
    const res = await container.saveDailyPlan(date, blocksToPayload(normalised, date, Number(nextBudget) || 150));
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return false;
    }
    const savedBlocks = normaliseBlocks(res.value.plan?.items, date);
    setBlocks(savedBlocks);
    setBudget(String(Number(res.value.plan?.availableMinutes) || Number(nextBudget) || 150));
    setDraft(freshBlock(date, savedBlocks.length, !savedBlocks.some((block) => block.isMust)));
    setEditingId(null);
    setSaved(true);
    return true;
  }, [budget, date]);

  const save = useCallback(async () => {
    const task = draft.task.trim();
    const doneWhen = draft.doneWhen.trim();
    const minutes = durationBetween(draft.start, draft.end);
    if (!task) return setError('Write what you will work on.');
    if (!doneWhen) return setError('Define what done looks like.');
    if (!normaliseTime(draft.start) || !normaliseTime(draft.end) || minutes < 5) {
      return setError('Choose a start and hard stop that create a block of at least 5 minutes.');
    }
    if (!editingId && blocks.length >= MAX_DAILY_PRIORITIES) {
      return setError(`Keep no more than ${MAX_DAILY_PRIORITIES} blocks per day.`);
    }

    const nextBlock = { ...draft, date, task, doneWhen, minutes };
    let nextBlocks = editingId
      ? blocks.map((block) => (block.id === editingId ? nextBlock : block))
      : [...blocks, nextBlock];
    if (nextBlock.isMust || !nextBlocks.some((block) => block.isMust)) {
      nextBlocks = nextBlocks.map((block) => ({ ...block, isMust: block.id === nextBlock.id }));
    }
    await persist(sortBlocks(nextBlocks));
  }, [blocks, date, draft, editingId, persist]);

  const editBlock = useCallback((block) => {
    setDraft({ ...block });
    setEditingId(block.id);
    setSaved(false);
    setError(null);
  }, []);

  const deleteBlock = useCallback((block) => {
    Alert.alert('Delete this plan?', block.task, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => persist(blocks.filter((item) => item.id !== block.id)),
      },
    ]);
  }, [blocks, persist]);

  const updateStatus = useCallback((block, status) => {
    persist(blocks.map((item) => (item.id === block.id ? { ...item, status } : item)));
  }, [blocks, persist]);

  const selectTime = (kind, value) => {
    if (kind === 'start') {
      const currentDuration = durationBetween(draft.start, draft.end) || 50;
      setDraft((current) => ({ ...current, start: value, end: addMinutes(value, currentDuration), minutes: currentDuration }));
    } else {
      setDraft((current) => ({ ...current, end: value }));
    }
    setPicker(null);
    setSaved(false);
  };

  const cancelEdit = () => {
    setDraft(freshBlock(date, blocks.length, !blocks.some((block) => block.isMust)));
    setEditingId(null);
    setError(null);
  };

  const draftDuration = durationBetween(draft.start, draft.end);
  const savedMinutes = blocks.reduce((total, block) => total + blockMinutes(block), 0);
  const editingOriginal = editingId ? blocks.find((block) => block.id === editingId) : null;
  const plannedMinutes = savedMinutes - (editingOriginal ? blockMinutes(editingOriginal) : 0) + (draft.task.trim() ? draftDuration : 0);
  const budgetMinutes = Number(budget) || 0;
  const overBudget = plannedMinutes > budgetMinutes;
  const overlap = draft.task.trim() && blocks.some((block) => block.id !== editingId && overlaps(draft, block));
  const late = draft.task.trim() && lateStop(draft);

  if (loading) {
    return <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}><LoadingState label="Loading your plan…" /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'right', 'bottom', 'left']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCard}>
          <View style={styles.rowBetween}>
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>DAILY PLANNER</Text>
            <Pressable accessible accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => navigation.navigate('Settings')} hitSlop={8} style={styles.settingsButton}>
              <Text style={{ color: colors.primarySoft, fontSize: 18 }}>⚙</Text>
            </Pressable>
          </View>
          <Text style={[typography.h1, { marginTop: spacing.sm }]}>Plan your day</Text>
          <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.xs }]}>What you'll work on, what done looks like, and when you stop.</Text>
          <View style={[styles.rowBetween, { marginTop: spacing.xl }]}>
            <Text style={[typography.tiny, { color: colors.textSoft }]}>PLANNING FOR</Text>
            <View style={styles.datePill}><Text style={[typography.small, { color: colors.text }]}>{formatDate(date)}</Text></View>
          </View>
          <View style={[styles.row, styles.segmented, { marginTop: spacing.md }]}>
            {['today', 'tomorrow'].map((mode) => (
              <Pressable
                key={mode}
                accessible
                accessibilityRole="button"
                accessibilityState={{ selected: dayMode === mode }}
                accessibilityLabel={mode === 'today' ? 'For Today' : 'Tomorrow'}
                onPress={() => setDayMode(mode)}
                style={[{ flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm }, dayMode === mode && { backgroundColor: colors.primary }]}
              >
                <Text style={[typography.small, dayMode === mode && { color: colors.white, fontWeight: '700' }]}>{mode === 'today' ? 'For Today' : 'Tomorrow'}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {error ? <Banner tone="negative">{error}</Banner> : null}
        {saved ? <Banner tone="positive">Plan saved.</Banner> : null}

        <View style={[styles.card, { marginTop: spacing.lg }]}>
          <View style={styles.rowBetween}>
            <Text style={[typography.tiny, { color: colors.accent, fontWeight: '700' }]}>{editingId ? 'EDIT BLOCK' : 'NEW FOCUS BLOCK'}</Text>
            <Text style={typography.tiny}>{blocks.length}/{MAX_DAILY_PRIORITIES}</Text>
          </View>
          <Text style={[typography.h3, { marginTop: spacing.lg }]}>Task</Text>
          <Field value={draft.task} onChangeText={(value) => updateDraft('task', value)} placeholder="ADS: confidence intervals, 3 solved examples" accessibilityLabel="Task" />

          <Text style={[typography.h3, { marginTop: spacing.lg }]}>Done when</Text>
          <Field value={draft.doneWhen} onChangeText={(value) => updateDraft('doneWhen', value)} placeholder="5 practice questions solved, mistakes noted" accessibilityLabel="Done when" />

          <Text style={[typography.h3, { marginTop: spacing.lg }]}>When will I start, and what is my hard stop?</Text>
          <View style={[styles.row, { marginTop: spacing.sm }]}>
            <TimeSelector label="Start" value={draft.start} onPress={() => setPicker('start')} style={{ marginRight: spacing.sm }} />
            <TimeSelector label="Hard stop" value={draft.end} onPress={() => setPicker('end')} />
          </View>
          <View style={[styles.metricPanel, styles.rowBetween, { marginTop: spacing.md }]}>
            <View>
              <Text style={[typography.tiny, { color: colors.textSoft }]}>TIME BLOCK</Text>
              <Text style={[typography.small, { marginTop: spacing.xs }]}>Protected focus time</Text>
            </View>
            <Text style={[typography.h3, { color: colors.accent }]}>{formatDuration(draftDuration)}</Text>
          </View>
          {late ? <Text style={[typography.small, { marginTop: spacing.xs, color: colors.warning }]}>Hard stop is after 11:30 PM.</Text> : null}
          {overlap ? <Text style={[typography.small, { marginTop: spacing.xs, color: colors.warning }]}>This block overlaps another saved block.</Text> : null}

          <Text style={[typography.h3, { marginTop: spacing.lg }]}>Type</Text>
          <View style={[styles.wrap, { marginTop: spacing.xs }]}>
            {WORK_TYPES.map((type) => (
              <Pressable
                key={type}
                accessible
                accessibilityRole="button"
                accessibilityState={{ selected: draft.type === type }}
                onPress={() => updateDraft('type', type)}
                style={[styles.chip, draft.type === type && { backgroundColor: colors.primaryTint, borderColor: colors.primary }]}
              >
                <Text style={[typography.tiny, draft.type === type && { color: colors.primarySoft, fontWeight: '700' }]}>{type}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessible
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.isMust }}
            onPress={() => updateDraft('isMust', true)}
            style={[styles.chip, { alignSelf: 'flex-start', marginTop: spacing.sm }, draft.isMust && { backgroundColor: colors.primaryTint, borderColor: colors.primary }]}
          >
            <Text style={[typography.tiny, draft.isMust && { color: colors.primarySoft, fontWeight: '700' }]}>★ Must-do block</Text>
          </Pressable>

          <Button label="Save plan" onPress={save} loading={saving} disabled={saving} style={{ marginTop: spacing.lg }} />
          {editingId ? <Button label="Cancel edit" variant="ghost" onPress={cancelEdit} disabled={saving} style={{ marginTop: spacing.xs }} /> : null}
        </View>

        <View style={[styles.card, { borderColor: overBudget ? colors.warning : colors.border, marginTop: spacing.md }]}>
          <View style={styles.rowBetween}>
            <Text style={typography.h3}>Day total</Text>
            <Text style={[typography.h3, overBudget && { color: colors.warning }]}>Planned {plannedMinutes} of {budgetMinutes} min</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
            <Text style={typography.tiny}>BUDGET</Text>
            <TextInput
              accessible
              accessibilityLabel="Daily budget in minutes"
              value={budget}
              onChangeText={(value) => setBudget(value.replace(/\D/g, ''))}
              keyboardType="number-pad"
              style={[styles.input, { width: 96, minHeight: 42, textAlign: 'center' }]}
            />
          </View>
          {overBudget ? <Text style={[typography.small, { color: colors.warning, marginTop: spacing.sm }]}>This plan is over your daily budget.</Text> : null}
        </View>

        <View style={[styles.rowBetween, { marginTop: spacing.md, marginBottom: spacing.sm }]}>
          <Text style={typography.h2}>Your plan</Text>
          <Text style={typography.tiny}>{blocks.length}/{MAX_DAILY_PRIORITIES} blocks</Text>
        </View>
        {blocks.length === 0 ? (
          <View style={styles.card}><Text style={typography.small}>Your saved blocks will appear here.</Text></View>
        ) : blocks.map((block) => (
          <View key={block.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={[typography.tiny, { color: colors.primarySoft }]}>{block.isMust ? '★ ' : ''}{formatTime(block.start)} – {formatTime(block.end)}</Text>
              <Text style={typography.tiny}>{formatDuration(blockMinutes(block))}</Text>
            </View>
            <Text style={[typography.h3, { marginTop: spacing.sm }]}>{block.task}</Text>
            <Text style={[typography.small, { marginTop: spacing.xs }]}>Done when: {block.doneWhen}</Text>
            <View style={[styles.rowBetween, { marginTop: spacing.md }]}>
              <Text style={[typography.tiny, { color: colors.text }]}>{block.type}</Text>
              <View style={styles.row}>
                <Pressable accessible accessibilityRole="button" accessibilityLabel={`Edit ${block.task}`} onPress={() => editBlock(block)} hitSlop={8} style={{ padding: spacing.xs }}>
                  <Text style={[typography.small, { color: colors.primarySoft, fontWeight: '700' }]}>Edit</Text>
                </Pressable>
                <Pressable accessible accessibilityRole="button" accessibilityLabel={`Delete ${block.task}`} onPress={() => deleteBlock(block)} hitSlop={8} style={{ padding: spacing.xs, marginLeft: spacing.sm }}>
                  <Text style={[typography.small, { color: colors.negative, fontWeight: '700' }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
            <Text style={[typography.tiny, { marginTop: spacing.md }]}>AFTER THE HARD STOP</Text>
            <View style={[styles.wrap, { marginTop: spacing.xs }]}>
              {STATUS_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  accessible
                  accessibilityRole="button"
                  accessibilityState={{ selected: block.status === option.value }}
                  onPress={() => updateStatus(block, option.value)}
                  style={[styles.chip, block.status === option.value && { backgroundColor: colors.primaryTint, borderColor: colors.primary }]}
                >
                  <Text style={[typography.tiny, block.status === option.value && { color: colors.primarySoft, fontWeight: '700' }]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <SelectorModal kind={picker} value={draft[picker === 'start' ? 'start' : 'end']} onClose={() => setPicker(null)} onSelect={(value) => selectTime(picker, value)} />
    </SafeAreaView>
  );
}

const modalStyles = {
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0, 0, 0, 0.68)' },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent', marginBottom: spacing.xs },
};
