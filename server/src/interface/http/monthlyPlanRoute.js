import express from 'express';
import crypto from 'node:crypto';
import { container, bootstrap } from '../../shared/di/container.js';
import {
  buildMonthlyAnalytics,
  ISO_MONTH,
  monthEnd,
  monthForDate,
  monthName,
  monthYear,
  normaliseMonthlyPlan,
  previousMonth,
  validateMonthlyPlan,
  weekCountForMonth,
} from '../../domain/services/MonthlyPlan.js';
import { MONTHLY_PLAN_SYSTEM_PROMPT, monthlyPlanExtractionPrompt } from '../../infrastructure/ai/monthlyPlanPrompt.js';
import { SCHEMAS } from '../../infrastructure/ai/schemas.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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

function decodeImage(input) {
  const mimeType = String(input?.mimeType ?? '').toLowerCase();
  const base64 = String(input?.base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!IMAGE_TYPES.has(mimeType)) throw new Error('Only JPEG, PNG, and WebP images are supported.');
  if (!base64) throw new Error('The image did not contain readable data. Please choose the photo again.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('The image must be smaller than 8 MB.');
  return {
    mimeType,
    base64,
    bytes: buffer.length,
    fileName: String(input?.fileName ?? 'monthly-plan-image').slice(0, 200),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function validateMonth(value) {
  return ISO_MONTH.test(String(value ?? ''));
}

function monthInfo(month) {
  return {
    month,
    monthName: monthName(month),
    year: monthYear(month),
    monthEnd: monthEnd(month),
    weekCount: weekCountForMonth(month),
  };
}

async function statusForDate(date) {
  const current = monthForDate(date);
  const prior = previousMonth(current);
  const [previousRecord, currentRecord] = await Promise.all([
    container.monthlyPlanRepository.markFailed(prior, {
      monthEnd: monthEnd(prior),
      monthName: monthName(prior),
      year: monthYear(prior),
    }),
    container.monthlyPlanRepository.findByMonth(current),
  ]);
  return {
    currentMonth: monthInfo(current),
    previousMonth: publicRecord(previousRecord),
    record: publicRecord(currentRecord),
    reminder: currentRecord?.status !== 'COMPLETED',
  };
}

async function monthlySources(month) {
  const monthStart = `${month}-01`;
  const end = monthEnd(month);
  const [dailyLogs, weeklyPlans] = await Promise.all([
    container.dailyLogRepository.findByMonth(month),
    container.weeklyPlanRepository.list(1000),
  ]);
  return {
    dailyLogs,
    weeklyPlans: weeklyPlans.filter((plan) => {
      const start = plan.weekStart ?? '';
      const finish = plan.weekEnd ?? start;
      return start <= end && finish >= monthStart;
    }),
  };
}

export function monthlyPlanRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '16mb' }));

  router.get('/api/months/status', async (req, res) => {
    await bootstrap();
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    if (!ISO_DATE.test(date)) return res.status(400).json({ error: { code: 'INVALID_DATE', message: 'date must be YYYY-MM-DD' } });
    res.json(await statusForDate(date));
  });

  router.get('/api/months/:month/plan', async (req, res) => {
    if (!validateMonth(req.params.month)) return res.status(400).json({ error: { code: 'INVALID_MONTH', message: 'month must be YYYY-MM' } });
    await bootstrap();
    const record = await container.monthlyPlanRepository.findByMonth(req.params.month);
    const sources = await monthlySources(req.params.month);
    res.json({
      month: monthInfo(req.params.month),
      record: publicRecord(record),
      analytics: record ? buildMonthlyAnalytics({ monthlyPlan: record, ...sources }) : null,
    });
  });

  router.post('/api/months/:month/plan/extract', async (req, res) => {
    if (!validateMonth(req.params.month)) return res.status(400).json({ error: { code: 'INVALID_MONTH', message: 'month must be YYYY-MM' } });
    if (!process.env.OPENROUTER_API_KEY) return res.status(503).json({ error: { code: 'NO_PROVIDER', message: 'OPENROUTER_API_KEY is not configured on the server.' } });

    let image;
    try {
      image = decodeImage(req.body?.image);
    } catch (error) {
      return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: error.message } });
    }

    await bootstrap();
    try {
      const { createOpenRouterAdapter } = await import('../../infrastructure/ai/openRouterClient.js');
      const info = monthInfo(req.params.month);
      const prompt = monthlyPlanExtractionPrompt(info);
      const result = await createOpenRouterAdapter().structured({
        task: 'monthlyPlanExtraction',
        system: MONTHLY_PLAN_SYSTEM_PROMPT,
        prompt,
        userContent: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
        ],
        schema: SCHEMAS.monthlyPlanExtraction,
        temperature: 0.1,
        maxTokens: 4500,
      });
      const plan = normaliseMonthlyPlan({ month: req.params.month, input: result.data, image });
      const saved = await container.monthlyPlanRepository.upsertDraft(req.params.month, plan);
      const needsClearerImage = plan.confidence === 'low' || plan.unclearSections.length > 0;
      res.json({
        month: monthInfo(req.params.month),
        record: publicRecord(saved),
        plan: publicRecord(plan),
        needsClearerImage,
        warning: needsClearerImage ? 'Some sections were unclear. Upload a clearer image before confirming.' : null,
        model: result.model,
      });
    } catch {
      res.status(502).json({ error: { code: 'MONTHLY_EXTRACTION_FAILED', message: 'The handwritten monthly plan could not be read. Please upload a clearer image and try again.' } });
    }
  });

  router.put('/api/months/:month/plan/confirm', async (req, res) => {
    if (!validateMonth(req.params.month)) return res.status(400).json({ error: { code: 'INVALID_MONTH', message: 'month must be YYYY-MM' } });
    await bootstrap();
    const existing = await container.monthlyPlanRepository.findByMonth(req.params.month);
    if (!existing?.image?.base64) return res.status(400).json({ error: { code: 'UPLOAD_REQUIRED', message: 'Upload and extract a clear monthly planning image before confirming.' } });

    const plan = normaliseMonthlyPlan({
      month: req.params.month,
      input: req.body?.plan ?? req.body ?? {},
      image: existing.image,
    });
    const validation = validateMonthlyPlan(plan);
    if (!validation.ok) return res.status(400).json({ error: { code: 'INCOMPLETE_MONTHLY_PLAN', message: validation.message, missingAnswers: validation.missingAnswers } });

    const saved = await container.monthlyPlanRepository.confirm(req.params.month, plan);
    const sheets = await container.queueMonthToSheets(req.params.month);
    res.json({
      record: publicRecord(saved),
      status: 'COMPLETED',
      sheets: sheets?.value?.queued ? { synced: false, skipped: true, queued: true } : { synced: false, skipped: true },
    });
  });

  return router;
}
