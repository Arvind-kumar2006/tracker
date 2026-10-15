/**
 * Repositories — the Mongo adapters behind the application's ports.
 * Every write is an upsert keyed on a natural id, which is what makes re-importing the same
 * workbook safe (FR-6.4 / FR-1.7).
 */

import { getDb } from './connection.js';

const contentHash = (obj) => {
  let h = 5381;
  const s = JSON.stringify(obj);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
};

/* ------------------------------------------------------------------ */

export const DailyLogRepository = {
  async upsertMany(entries, { fileName } = {}) {
    const col = getDb().collection('daily_logs');
    const ops = entries.map((e) => ({
      updateOne: {
        filter: { _id: e.date },
        update: {
          $set: {
            date: e.date,
            month: e.month,
            weekday: e.weekday,
            sheetRow: e.sheetRow,
            hasData: e.hasData,
            hasMinutes: e.hasMinutes,
            plan: e.plan,
            minutes: e.minutes,
            totalHoursComputed: e.totalHoursComputed,
            totalHoursReported: e.totalHoursReported,
            variancePct: e.variancePct,
            totalWarning: e.totalWarning,
            targetMet: e.targetMet,
            accomplished: e.accomplished,
            buildOutcome: e.buildOutcome,
            buildNote: e.buildNote,
            blockers: e.blockers,
            tomorrowChange: e.tomorrowChange,
            timeBlocks: e.timeBlocks,
            sourceFile: fileName ?? e.sourceFile,
            // 'import' vs 'app' — an entry typed in the phone must stay distinguishable from a
            // row that came out of a workbook, or provenance is silently lost on the first save.
            origin: e.origin ?? 'import',
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    }));
    if (ops.length === 0) return { matched: 0, upserted: 0 };
    const res = await col.bulkWrite(ops, { ordered: false });
    return { matched: res.matchedCount, upserted: res.upsertedCount, modified: res.modifiedCount };
  },

  async findByMonth(month) {
    return getDb()
      .collection('daily_logs')
      .find({ month })
      .sort({ date: 1 })
      .toArray();
  },

  async findByDate(date) {
    return getDb().collection('daily_logs').findOne({ _id: date });
  },

  async findWithData(month) {
    return getDb()
      .collection('daily_logs')
      .find({ month, hasData: true })
      .sort({ date: 1 })
      .toArray();
  },

  async count() {
    return getDb().collection('daily_logs').countDocuments();
  },
};

/* ------------------------------------------------------------------ */

export const MonthRepository = {
  async upsert(month, metrics, goal, targetHours) {
    await getDb()
      .collection('months')
      .updateOne(
        { _id: month },
        {
          $set: {
            monthlyGoal: goal ?? null,
            targetDailyHours: targetHours ?? null,
            metrics,
            lastUpdated: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
  },

  async find(month) {
    return getDb().collection('months').findOne({ _id: month });
  },

  async list() {
    return getDb()
      .collection('months')
      .find({})
      .sort({ _id: -1 })
      .toArray();
  },
};

/* ------------------------------------------------------------------ */

export const ImportLogRepository = {
  /**
   * Keyed on the file's sha256: re-importing an unchanged workbook is a no-op (FR-1.7).
   */
  async hasBeenImported(sha256) {
    return (await getDb().collection('import_logs').findOne({ _id: sha256 })) !== null;
  },

  async record(entry) {
    await getDb()
      .collection('import_logs')
      .updateOne(
        { _id: entry.sha256 },
        { $set: { ...entry, importedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
  },

  async list(limit = 50) {
    return getDb()
      .collection('import_logs')
      .find({})
      .sort({ importedAt: -1 })
      .limit(limit)
      .toArray();
  },
};

/* ------------------------------------------------------------------ */

export const QuarantineRepository = {
  async insertMany(rows) {
    if (rows.length === 0) return 0;
    const col = getDb().collection('quarantine');
    const ops = rows.map((r) => ({
      updateOne: {
        filter: { _id: `${r.fileName}:${r.sheetRow}:${r.column}` },
        update: { $set: { ...r, resolvedAt: null } },
        upsert: true,
      },
    }));
    await col.bulkWrite(ops, { ordered: false });
    return rows.length;
  },

  async unresolved() {
    return getDb()
      .collection('quarantine')
      .find({ resolvedAt: null })
      .sort({ fileName: 1, sheetRow: 1 })
      .toArray();
  },

  async resolve(id) {
    await getDb().collection('quarantine').updateOne({ _id: id }, { $set: { resolvedAt: new Date() } });
  },

  async countUnresolved() {
    return getDb().collection('quarantine').countDocuments({ resolvedAt: null });
  },
};

/* ------------------------------------------------------------------ */

export const InsightRepository = {
  /** Keyed on contentHash so regeneration never duplicates (FR-4.6). */
  async upsertMany(insights, { month } = {}) {
    const col = getDb().collection('insights');
    let n = 0;
    for (const ins of insights) {
      const hash = contentHash({ s: ins.section, t: ins.title, b: ins.body });
      await col.updateOne(
        { _id: `${month}:${hash}` },
        {
          $set: {
            month,
            generatedAt: new Date(),
            dateScope: ins.dateScope ?? [],
            section: ins.section,
            title: ins.title,
            body: ins.body,
            evidenceDates: ins.evidenceDates ?? [],
            evidenceQuotes: ins.evidenceQuotes ?? [],
            severity: ins.severity ?? 'INFO',
            action: ins.action ?? null,
            constraintRef: ins.constraintRef ?? null,
            model: ins.model ?? null,
            tokens: ins.tokens ?? null,
            costCredits: ins.costCredits ?? null,
            contentHash: hash,
          },
          $setOnInsert: { status: 'OPEN', userResponse: null, createdAt: new Date() },
        },
        { upsert: true }
      );
      n++;
    }
    return n;
  },

  async findByMonth(month) {
    return getDb()
      .collection('insights')
      .find({ month })
      .sort({ severity: 1, generatedAt: -1 })
      .toArray();
  },

  async setStatus(id, status) {
    await getDb().collection('insights').updateOne({ _id: id }, { $set: { status, respondedAt: new Date() } });
  },

  async dismissAllForMonth(month) {
    // Remembered so the AI stops repeating an ignored insight.
    await getDb().collection('insights').updateMany({ month, status: 'OPEN' }, { $set: { status: 'DISMISSED' } });
  },

  async spendForMonth(month) {
    const rows = await getDb()
      .collection('insights')
      .find({ month }, { projection: { costCredits: 1 } })
      .toArray();
    return rows.reduce((s, r) => s + (r.costCredits ?? 0), 0);
  },
};

/* ------------------------------------------------------------------ */

export const PlanCritiqueRepository = {
  async upsert(date, critique) {
    await getDb()
      .collection('plan_critiques')
      .updateOne(
        { _id: date },
        { $set: { date, ...critique, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
  },

  async find(date) {
    return getDb().collection('plan_critiques').findOne({ _id: date });
  },

  async list(limit = 50) {
    return getDb()
      .collection('plan_critiques')
      .find({})
      .sort({ date: -1 })
      .limit(limit)
      .toArray();
  },
};

/* ------------------------------------------------------------------ */

export const SettingsRepository = {
  async get(key, fallback = null) {
    const doc = await getDb().collection('settings').findOne({ _id: key });
    return doc ? doc.value : fallback;
  },
  async set(key, value) {
    await getDb()
      .collection('settings')
      .updateOne({ _id: key }, { $set: { key, value, updatedAt: new Date() } }, { upsert: true });
  },
};

export { contentHash };