import express from 'express';
import { ok, err } from '../../shared/result.js';
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';
import { calculateMetrics } from '../../domain/services/MetricsCalculator.js';
import { container, bootstrap } from '../../shared/di/container.js';

export async function saveFocusSession({ date, payload, repositories, sheetsSync = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
    return err(new DomainError(ErrorCode.UNPARSEABLE_VALUE, `invalid date "${date}"`));
  }

  const durationMinutes = Number(payload?.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
    return err(new DomainError(ErrorCode.IMPOSSIBLE_RANGE, 'durationMinutes must be between 1 and 720.'));
  }

  const existing = await repositories.dailyLogRepository.findByDate(date);
  if (!existing) {
    return err(new DomainError(ErrorCode.UNPARSEABLE_VALUE, `No daily plan exists for ${date}.`));
  }

  const items = existing.plan?.items ?? [];
  const itemId = String(payload?.itemId ?? '');
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) {
    return err(new DomainError(ErrorCode.UNPARSEABLE_VALUE, 'The selected plan priority no longer exists.'));
  }

  // The mobile timer keeps a stable id while retrying a request. If the network drops after
  // Mongo has committed the session, treating the retry as the same write prevents duplicate
  // minutes from being added to the priority.
  const requestedId = typeof payload?.id === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(payload.id)
    ? payload.id
    : null;
  const existingSession = requestedId
    ? (existing.focusSessions ?? []).find((session) => session.id === requestedId)
    : null;
  if (existingSession) {
    return ok({
      date,
      itemId,
      session: existingSession,
      plan: existing.plan,
      written: { matched: 0, modified: 0, idempotent: true },
      sheets: { synced: false, skipped: true },
      idempotent: true,
    });
  }

  const now = new Date();
  const session = {
    id: requestedId ?? `${date}-${now.getTime()}`,
    itemId,
    startedAt: payload?.startedAt && !Number.isNaN(Date.parse(payload.startedAt)) ? payload.startedAt : now.toISOString(),
    endedAt: payload?.endedAt && !Number.isNaN(Date.parse(payload.endedAt)) ? payload.endedAt : now.toISOString(),
    durationMinutes: Math.round(durationMinutes),
    interrupted: Boolean(payload?.interrupted),
  };
  const plan = {
    ...existing.plan,
    items: items.map((candidate) => candidate.id === itemId
      ? { ...candidate, actualMinutes: Number(candidate.actualMinutes ?? 0) + session.durationMinutes }
      : candidate),
  };
  const entry = {
    ...existing,
    plan,
    focusSessions: [...(existing.focusSessions ?? []), session],
    hasData: true,
  };

  const write = await repositories.dailyLogRepository.upsertMany([entry], { fileName: null });
  const entries = await repositories.dailyLogRepository.findByMonth(existing.month);
  const metrics = calculateMetrics({ entries, month: existing.month, asOf: new Date().toISOString().slice(0, 10) });
  const month = await repositories.monthRepository.find(existing.month);
  await repositories.monthRepository.upsert(existing.month, metrics, month?.monthlyGoal ?? null, month?.targetDailyHours ?? null);

  let sheets = { synced: false, skipped: true };
  if (sheetsSync) {
    try {
      const mirror = await sheetsSync(existing.month);
      sheets = mirror?.ok
        ? mirror.value?.queued
          ? { synced: false, skipped: true, queued: true }
          : { synced: true, totals: mirror.value?.totals ?? null }
        : { synced: false, error: mirror?.error?.message ?? 'Google Sheets sync failed' };
    } catch (e) {
      sheets = { synced: false, error: e.message };
    }
  }

  return ok({ date, itemId, session, plan, written: write, sheets });
}

export function focusSessionRouter() {
  const router = express.Router();

  router.post('/api/days/:date/focus-sessions', async (req, res) => {
    await bootstrap();
    const result = await saveFocusSession({
      date: req.params.date,
      payload: req.body ?? {},
      repositories: {
        dailyLogRepository: container.dailyLogRepository,
        monthRepository: container.monthRepository,
      },
      sheetsSync: (month) => container.queueMonthToSheets(month),
    });
    if (!result.ok) return res.status(400).json({ error: result.error.toJSON() });
    res.json(result.value);
  });

  return router;
}

