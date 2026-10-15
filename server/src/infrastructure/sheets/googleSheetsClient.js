/**
 * GoogleSheetsClient — thin wrapper over the Sheets/Drive APIs.
 *
 * Credentials are read LAZILY. Importing this module must never throw, so the pure-domain and
 * Mongo test suites can run with no Google account configured at all (same pattern as the AI
 * adapter reading OPENROUTER_API_KEY).
 */

import { google } from 'googleapis';
import fs from 'node:fs';
// This file sits at src/infrastructure/sheets/ -> two levels up reaches src/.
import { DomainError, ErrorCode } from '../../domain/errors/DomainError.js';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

/**
 * Service-account JSON pasted into an env var usually has its PEM newlines escaped as \n.
 * Un-escaping here means the user does not have to do it by hand.
 */
export function parseServiceAccount(raw) {
  if (!raw) {
    throw new DomainError(
      ErrorCode.CONFIG_MISSING,
      'GOOGLE_SERVICE_ACCOUNT_JSON is not set. See docs/SECURITY.md.'
    );
  }

  let json = raw.trim();
  // Accept either the JSON itself or a path to a local service-account JSON file.
  if (!json.startsWith('{') && fs.existsSync(json)) {
    json = fs.readFileSync(json, 'utf8').trim();
  }

  // Tolerate a base64-wrapped value too.
  if (!json.startsWith('{')) {
    try {
      json = Buffer.from(json, 'base64').toString('utf8');
    } catch {
      /* fall through to the JSON parse below for a clear error */
    }
  }

  let creds;
  try {
    creds = JSON.parse(json);
  } catch (e) {
    throw new DomainError(ErrorCode.CONFIG_MISSING, `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`);
  }

  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  if (!creds.client_email || !creds.private_key) {
    throw new DomainError(
      ErrorCode.CONFIG_MISSING,
      'GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key'
    );
  }
  return creds;
}

export function createSheetsClient({ json } = {}) {
  let authed = null;

  const getClient = () => {
    if (authed) return authed;
    const credentials = parseServiceAccount(json);
    const client = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES,
      subject: process.env.GOOGLE_DELEGATED_USER || undefined, // optional domain-wide delegation
    });
    authed = { sheets: google.sheets({ version: 'v4', auth: client }), drive: google.drive({ version: 'v3', auth: client }) };
    return authed;
  };

  return {
    get sheets() {
      return getClient().sheets;
    },
    get drive() {
      return getClient().drive;
    },

    /** Raw A1 values for a range. */
    async readRange(spreadsheetId, range) {
      const res = await getClient().sheets.spreadsheets.values.get({ spreadsheetId, range });
      return res.data.values ?? [];
    },

    /** Overwrite a range. USER_ENTERED so dates/numbers stay typed. */
    async writeRange(spreadsheetId, range, values, valueInputOption = 'USER_ENTERED') {
      const res = await getClient().sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption,
        requestBody: { values },
      });
      return res.data;
    },

    /** Append after the last populated row of a table. */
    async appendRange(spreadsheetId, range, values, valueInputOption = 'USER_ENTERED') {
      const res = await getClient().sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption,
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
      return res.data;
    },

    async getSpreadsheet(spreadsheetId) {
      const res = await getClient().sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
      return res.data;
    },

    async createSpreadsheet({ title, sheets }) {
      const res = await getClient().sheets.spreadsheets.create({
        requestBody: {
          properties: { title },
          sheets: sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })),
        },
      });
      return res.data;
    },

    async batchUpdate(spreadsheetId, requests) {
      const res = await getClient().sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      return res.data;
    },

    /** Share with a human so the workbook is actually reachable (Drive API). */
    async share(spreadsheetId, email, role = 'writer') {
      const res = await getClient().drive.permissions.create({
        fileId: spreadsheetId,
        sendNotificationEmail: false,
        requestBody: { type: 'user', role, emailAddress: email },
      });
      return res.data;
    },
  };
}

export { SCOPES };
