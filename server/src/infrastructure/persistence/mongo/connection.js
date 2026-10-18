/**
 * Mongo connection + index bootstrap.
 *
 * Design note: MongoDB is the SYSTEM OF RECORD. Google Sheets is the human-readable projection
 * (the "accountability mirror"). Natural `_id`s give free idempotency, which is why the Sheets
 * append-only idempotency hacks described in the original PRD are not needed here.
 *
 * Collections and their keys:
 *   daily_logs   _id = "2026-10-05"          natural date key -> upsert is idempotent
 *   months       _id = "2026-10"
 *   import_logs  _id = sha256 of the file    re-importing the same file is a no-op
 *   quarantine   _id = file:row:column       same cell always lands in the same document
 *   insights     _id = contentHash           regeneration does not duplicate rows
 *   plan_critiques _id = date
 */

import { MongoClient } from 'mongodb';
import { config } from '../../config/env.js';

let client = null;
let db = null;

export async function connect({ uri = config.mongo.uri, dbName = config.mongo.dbName } = {}) {
  if (db) return db;

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);
  return db;
}

export function getDb() {
  if (!db) throw new Error('[mongo] not connected — call connect() first');
  return db;
}

export async function close() {
  if (client) await client.close();
  client = null;
  db = null;
}

export async function ping() {
  const d = getDb();
  const res = await d.command({ ping: 1 });
  return res.ok === 1;
}

export async function ensureIndexes(d) {
  await Promise.all([
    d.collection('daily_logs').createIndex({ month: 1, date: 1 }),
    d.collection('daily_logs').createIndex({ 'blockers.machineWritten': 1 }),
    d.collection('time_blocks').createIndex({ date: 1, startMinutes: 1 }),
    d.collection('months').createIndex({ lastUpdated: -1 }),
    d.collection('insights').createIndex({ month: 1, generatedAt: -1 }),
    d.collection('insights').createIndex({ status: 1 }),
    d.collection('plan_critiques').createIndex({ date: -1 }),
    d.collection('import_logs').createIndex({ importedAt: -1 }),
    d.collection('quarantine').createIndex({ fileName: 1, resolvedAt: 1 }),
    d.collection('settings').createIndex({ key: 1 }, { unique: true }),
    d.collection('monthly_plans').createIndex({ month: -1 }),
  ]);
}
