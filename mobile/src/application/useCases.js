/**
 * Application use cases. Each depends only on a port, never on expo, React, or the network
 * directly — which is why the whole of this layer is testable in plain node.
 */

import { ok, err } from '../shared/result.js';

const SPREADSHEET_EXT = /\.(xlsx|xlsm|xls)$/i;

/** Files the user never means to import: Office lock files and macOS resource forks. */
const isJunk = (name) => name.startsWith('~$') || name.startsWith('._') || name === '.DS_Store';

/**
 * ImportWorkbooks — the on-device import flow (PRD FR-1.2).
 *
 * Files are read as base64 and uploaded; parsing happens on the server, which owns the single
 * normaliser. See infra/filesystem note for why folder *enumeration* is not possible on-device
 * and why picking files is the primary path.
 */
export async function importWorkbooks({ fileSystem, api, folder, force = false, asOf }) {
  let files;
  let label = folder ?? null;

  if (folder && fileSystem.listSpreadsheets) {
    const listed = await fileSystem.listSpreadsheets(folder);
    if (listed.ok) files = listed.value;
  }

  if (!files || files.length === 0) {
    const picked = await fileSystem.pickFiles();
    if (!picked.ok) return picked;
    files = picked.value;
    label = label ?? '(device selection)';
  }

  const candidates = files.filter((f) => SPREADSHEET_EXT.test(f.name) && !isJunk(f.name));
  if (candidates.length === 0) {
    return err({
      code: 'NO_SPREADSHEETS',
      message: 'That selection contains no .xlsx files.',
      folder: label,
    });
  }

  const payload = [];
  for (const file of candidates) {
    const read = await fileSystem.readBase64(file.uri);
    if (!read.ok) return read;
    payload.push({ name: file.name, base64: read.value, size: file.size });
  }

  const totalBytes = candidates.reduce((s, f) => s + (f.size ?? 0), 0);

  // A pre-flight preview so the user confirms before spending a round trip on a big upload.
  return ok({
    folder: label,
    fileCount: candidates.length,
    totalBytes,
    files: candidates.map((c) => ({ name: c.name, size: c.size })),
    // The caller decides when to actually upload.
    upload: () => api.uploadWorkbooks(payload, { folder: label, force, asOf }),
  });
}

/** Load everything the dashboard needs in one shot, tolerating a partial failure. */
export async function loadDashboard({ api, month, asOf }) {
  const [metrics, days] = await Promise.all([api.getMetrics(month), api.getDays(month, { withData: true })]);

  if (!metrics.ok) return metrics;
  if (!days.ok) return days;

  return ok({
    month,
    asOf,
    metrics: metrics.value,
    entries: days.value,
  });
}

/** Run the analysis graph. A 422 means "not enough data" and is a legitimate outcome. */
export async function runAnalysis({ api, month, asOf }) {
  const result = await api.analyse(month, { asOf });
  if (!result.ok) {
    if (result.error.status === 422) {
      return ok({ insufficient: result.error.payload?.insufficient ?? null, bundle: null });
    }
    return result;
  }
  return ok({ insufficient: null, bundle: result.value.bundle });
}

export async function loadInsights({ api, month }) {
  return api.getInsights(month);
}

export async function updateInsightStatus({ api, id, status }) {
  return api.setInsightStatus(id, status);
}