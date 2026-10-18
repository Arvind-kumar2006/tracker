import express from 'express';
import crypto from 'node:crypto';
import { container, bootstrap } from '../../shared/di/container.js';
import {
  buildWeeklyAnalytics,
  normaliseWeeklyPlan,
  previousWeekStart,
  validateWeeklyPlan,
  weekEndForStart,
  weekNumberOfMonth,
  weekStartForDate,
  ISO_DATE,
} from '../../domain/services/WeeklyPlan.js';
import { WEEKLY_PLAN_SYSTEM_PROMPT, weeklyPlanExtractionPrompt } from '../../infrastructure/ai/weeklyPlanPrompt.js';
import { SCHEMAS } from '../../infrastructure/ai/schemas.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function publicRecord(record) {
  if (!record) return null;
  const { image, ...rest } = record;
  return {
    ...rest,
    image: image ? {
      mimeType: image.mimeType ?? null,
      fileName: image.fileName ?? null,
      sha256: image.sha256 ?? null,
      bytes: image.bytes ?? null,
    } : null,
  };
}

function validateWeekStart(value) {
  if (!ISO_DATE.test(String(value ?? ''))) return false;
  return weekStartForDate(value) === value;
}

function decodeImage(input) {
  const mimeType = String(input?.mimeType ?? '').toLowerCase();
  const base64 = String(input?.base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!IMAGE_TYPES.has(mimeType)) throw new Error('Only JPEG, PNG, and WebP images are supported.');
  if (!base64) throw new Error('The image did not contain readable data. Please choose the photo again.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('The image must be smaller than 8 MB.');
  }
  return {
    mimeType,
    base64,
    bytes: buffer.length,
    fileName: String(input?.fileName ?? 'weekly-plan-image').slice(0, 200),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

async function dailyLogsForWeek(weekStart) {
  const end = weekEndForStart(weekStart);
  const months = [...new Set([weekStart.slice(0, 7), end.slice(0, 7)])];
  const rows = (await Promise.all(months.map((month) => container.dailyLogRepository.findByMonth(month))))
    .flat();
  return rows.filter((row) => row.date >= weekStart && row.date <= end);
}

async function statusForDate(date) {
  const currentWeekStart = weekStartForDate(date);
  const priorWeekStart = previousWeekStart(currentWeekStart);
  const previous = await container.weeklyPlanRepository.markFailed(priorWeekStart, {
    weekEnd: weekEndForStart(priorWeekStart),
    weekNumber: weekNumberOfMonth(priorWeekStart),
  });
  const current = await container.weeklyPlanRepository.findByWeekStart(currentWeekStart);
  return {
    currentWeek: {
      weekStart: currentWeekStart,
      weekEnd: weekEndForStart(currentWeekStart),
      weekNumber: weekNumberOfMonth(currentWeekStart),
    },
    previousWeek: publicRecord(previous),
    record: publicRecord(current),
    reminder: current?.status !== 'COMPLETED',
  };
}

export function weeklyPlanRouter() {
  const router = express.Router();
  // A camera image is base64 encoded in the mobile request and is intentionally larger than the
  // ordinary API body limit. The route still caps the decoded image at 8 MB below.
  router.use(express.json({ limit: '16mb' }));

  router.get('/api/weeks/status', async (req, res) => {
    await bootstrap();
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    if (!ISO_DATE.test(date)) return res.status(400).json({ error: { code: 'INVALID_DATE', message: 'date must be YYYY-MM-DD' } });
    res.json(await statusForDate(date));
  });

  router.get('/api/weeks/:weekStart', async (req, res) => {
    if (!validateWeekStart(req.params.weekStart)) {
      return res.status(400).json({ error: { code: 'INVALID_WEEK_START', message: 'weekStart must be a Monday in YYYY-MM-DD format' } });
    }
    await bootstrap();
    const record = await container.weeklyPlanRepository.findByWeekStart(req.params.weekStart);
    const dailyLogs = await dailyLogsForWeek(req.params.weekStart);
    res.json({
      week: {
        weekStart: req.params.weekStart,
        weekEnd: weekEndForStart(req.params.weekStart),
        weekNumber: weekNumberOfMonth(req.params.weekStart),
      },
      record: publicRecord(record),
      analytics: record ? buildWeeklyAnalytics({ weeklyPlan: record, dailyLogs }) : null,
    });
  });

  router.post('/api/weeks/:weekStart/extract', async (req, res) => {
    if (!validateWeekStart(req.params.weekStart)) {
      return res.status(400).json({ error: { code: 'INVALID_WEEK_START', message: 'weekStart must be a Monday in YYYY-MM-DD format' } });
    }
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ error: { code: 'NO_PROVIDER', message: 'OPENROUTER_API_KEY is not configured on the server.' } });
    }

    let image;
    try {
      image = decodeImage(req.body?.image);
    } catch (error) {
      return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: error.message } });
    }

    await bootstrap();
    try {
      const { createOpenRouterAdapter } = await import('../../infrastructure/ai/openRouterClient.js');
      const result = await createOpenRouterAdapter().structured({
        task: 'weeklyPlanExtraction',
        system: WEEKLY_PLAN_SYSTEM_PROMPT,
        prompt: weeklyPlanExtractionPrompt({
          weekStart: req.params.weekStart,
          weekEnd: weekEndForStart(req.params.weekStart),
        }),
        userContent: [
          {
            type: 'text',
            text: weeklyPlanExtractionPrompt({
              weekStart: req.params.weekStart,
              weekEnd: weekEndForStart(req.params.weekStart),
            }),
          },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
        ],
        schema: SCHEMAS.weeklyPlanExtraction,
        temperature: 0.1,
        maxTokens: 4000,
      });
      const plan = normaliseWeeklyPlan({
        weekStart: req.params.weekStart,
        input: result.data,
        image,
      });
      const saved = await container.weeklyPlanRepository.upsertDraft(req.params.weekStart, plan);
      const needsClearerImage = plan.confidence === 'low' || plan.unclearSections.length > 0;
      res.json({
        week: { weekStart: req.params.weekStart, weekEnd: weekEndForStart(req.params.weekStart), weekNumber: weekNumberOfMonth(req.params.weekStart) },
        record: publicRecord(saved),
        plan: publicRecord(plan),
        needsClearerImage,
        warning: needsClearerImage ? 'Some sections were unclear. Upload a clearer image before confirming, or correct the extracted fields below.' : null,
        model: result.model,
      });
    } catch (error) {
      res.status(502).json({ error: { code: 'WEEKLY_EXTRACTION_FAILED', message: 'The handwritten plan could not be read. Please upload a clearer image and try again.' } });
    }
  });

  router.put('/api/weeks/:weekStart/confirm', async (req, res) => {
    if (!validateWeekStart(req.params.weekStart)) {
      return res.status(400).json({ error: { code: 'INVALID_WEEK_START', message: 'weekStart must be a Monday in YYYY-MM-DD format' } });
    }
    await bootstrap();
    const existing = await container.weeklyPlanRepository.findByWeekStart(req.params.weekStart);
    if (!existing?.image?.base64) {
      return res.status(400).json({ error: { code: 'UPLOAD_REQUIRED', message: 'Upload and extract a clear weekly planning image before confirming.' } });
    }
    const plan = normaliseWeeklyPlan({
      weekStart: req.params.weekStart,
      input: req.body?.plan ?? req.body ?? {},
      image: existing?.image ?? null,
    });
    const validation = validateWeeklyPlan(plan);
    if (!validation.ok) return res.status(400).json({ error: { code: 'INCOMPLETE_WEEKLY_PLAN', message: validation.message, missingAnswers: validation.missingAnswers } });

    const saved = await container.weeklyPlanRepository.confirm(req.params.weekStart, plan);
    let sheets = { synced: false, skipped: true };
    try {
      const mirror = await container.syncMonthToSheets(req.params.weekStart.slice(0, 7));
      sheets = mirror?.ok
        ? { synced: true, totals: mirror.value?.totals ?? null }
        : { synced: false, error: mirror?.error?.message ?? 'Google Sheets sync failed' };
    } catch (error) {
      sheets = { synced: false, error: error.message };
    }
    res.json({ record: publicRecord(saved), status: 'COMPLETED', sheets });
  });

  return router;
}
