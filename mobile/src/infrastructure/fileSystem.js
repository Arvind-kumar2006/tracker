/**
 * FileSystemGateway implementation.
 *
 * A NOTE ON WHAT IS ACTUALLY POSSIBLE ON-DEVICE
 *
 * `expo-document-picker` (Expo Go) can select FILES but has no folder mode.
 * `@react-native-documents/picker` adds `pickDirectory()`, but v10 exposes NO directory
 * enumeration: there is no `listDirectory` and no `listAllFiles`. `pickDirectory()` returns a
 * URI and nothing about its children. So "import every .xlsx in a chosen folder" is not
 * achievable on-device with these libraries — enumerating a SAF tree needs native
 * DocumentFile/ContentResolver work that would mean writing a custom native module.
 *
 * The honest design, and what this file implements:
 *   - `pickFolder()`  — grabs a folder for provenance and labelling (dev build only).
 *   - `pickFiles()`   — the real path: the system picker filtered to spreadsheets, multi-select.
 *   - `readBase64()`  — reads via expo-file-system and returns base64 for upload.
 *
 * Full-folder import is covered by the BACKEND folder scan, which does work, because the
 * workbooks live on the Mac. See PRD §7.2 and the v1.2 decision note.
 */

import { ok, err } from '../shared/result.js';
import * as DocumentPicker from 'expo-document-picker';

const SPREADSHEET_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  '*/*',
];

const isSpreadsheet = (name) => /\.(xlsx|xlsm|xls)$/i.test(name ?? '');

/**
 * Lazily resolve the optional native picker.
 *
 * This MUST be lazy. An earlier version did `await import(...)` at module scope, which Metro and
 * Hermes cannot bundle — top-level await is not supported, and the failure surfaced only at
 * export time as `Unexpected token: name (_r)`.
 */
let pickerPromise = null;
let pickerModule = null;

async function ensurePicker() {
  if (pickerPromise) return pickerPromise;
  pickerPromise = (async () => {
    try {
      pickerModule = await import('@react-native-documents/picker');
      return pickerModule;
    } catch {
      // Expo Go, or the package is not linked in this build.
      pickerModule = null;
      return null;
    }
  })();
  return pickerPromise;
}

const CANCELLED = () => err(Object.assign(new Error('No selection made.'), { code: 'CANCELLED' }));

export function createFileSystem() {
  return {
    /** Async, because the picker module is resolved on demand. */
    canPickFolder: async () => Boolean((await ensurePicker())?.pickDirectory),

    /** Resolve the optional picker up front; safe to call more than once. */
    ensurePicker,

    /**
     * Folder selection is a dev-build nicety. It gives us a label and a provenance record, but
     * NOT the folder's contents — see the note at the top of this file.
     */
    async pickFolder() {
      const picker = await ensurePicker();
      if (!picker?.pickDirectory) {
        return err(
          Object.assign(
            new Error('Folder picking needs a development build. Run `npx expo prebuild` then `npx expo run:ios`.'),
            { code: 'NO_FOLDER_PICKER' }
          )
        );
      }
      try {
        const result = await picker.pickDirectory({ requestLongTermAccess: true });
        const uri = Array.isArray(result) ? result[0]?.uri : result?.uri;
        if (!uri) return CANCELLED();
        return ok({ uri, name: decodeURIComponent(String(uri).split('/').pop() ?? 'folder') });
      } catch (e) {
        if (/cancel/i.test(e?.message ?? '')) return CANCELLED();
        return err(e);
      }
    },

    /**
     * The real import path. Works in Expo Go AND in a dev build, which is why this is the
     * primary flow rather than the fallback.
     */
    async pickFiles() {
      try {
        // mode:'import' copies into the app cache, so the returned URI is directly readable and
        // does not need a long-lived permission grant.
        const res = await DocumentPicker.getDocumentAsync({
          type: SPREADSHEET_MIME,
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (res.canceled) return CANCELLED();
        const files = res.assets
          .filter((a) => isSpreadsheet(a.name))
          .map((a) => ({ name: a.name, uri: a.uri, size: a.size ?? 0 }));
        if (files.length === 0) {
          return err(
            Object.assign(new Error('None of the selected files looked like a spreadsheet (.xlsx).'), {
              code: 'NO_SPREADSHEETS',
            })
          );
        }
        return ok(files);
      } catch (e) {
        return err(e);
      }
    },

    /**
     * Retained for the port's shape. A folder URI cannot be enumerated with this library, so
     * this reports honestly rather than pretending.
     */
    async listSpreadsheets(folderUri) {
      if (!folderUri) return ok([]);
      return err(
        Object.assign(
          new Error(
            'On-device folder contents cannot be listed: the document picker exposes no directory ' +
              'enumeration. Pick the files instead, or use the backend folder scan.'
          ),
          { code: 'FOLDER_ENUM_UNSUPPORTED' }
        )
      );
    },

    async readBase64(uri) {
      try {
        const mod = await import('expo-file-system');
        // expo-file-system v18 returns a base64 string; older builds returned { data }.
        if (typeof mod.File === 'function') {
          return ok(new mod.File(uri).base64());
        }
        const legacy = await mod.readAsStringAsync(uri, { encoding: 'base64' });
        return ok(legacy?.data ?? legacy);
      } catch (e) {
        return err(e);
      }
    },
  };
}