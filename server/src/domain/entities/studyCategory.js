/**
 * StudyCategory — the four time buckets of the workbook (columns D, E, F, G).
 * These are the only categories the canonical schema knows about; free-form bucket names
 * found elsewhere in a workbook are quarantined rather than invented.
 */

export const StudyCategory = {
  GENAI: 'GENAI',
  CODING: 'CODING',
  ENGLISH: 'ENGLISH',
  OTHER: 'OTHER',
};

export const StudyCategoryLabel = {
  [StudyCategory.GENAI]: 'GenAI',
  [StudyCategory.CODING]: 'Coding',
  [StudyCategory.ENGLISH]: 'English',
  [StudyCategory.OTHER]: 'Other',
};

/**
 * Maps a canonical column letter to its category.
 * Note column G's header in the real file is bare "other" while D/E/F say "(h)" — they are
 * part of the same numeric series, so G is included here (PRD F1 / FR-2.4).
 */
export const CATEGORY_COLUMN = Object.freeze({
  D: StudyCategory.GENAI,
  E: StudyCategory.CODING,
  F: StudyCategory.ENGLISH,
  G: StudyCategory.OTHER,
});

/** Canonical storage key for a category's minute count. */
export const CATEGORY_FIELD = Object.freeze({
  [StudyCategory.GENAI]: 'genaiMinutes',
  [StudyCategory.CODING]: 'codingMinutes',
  [StudyCategory.ENGLISH]: 'englishMinutes',
  [StudyCategory.OTHER]: 'otherMinutes',
});

export const ALL_CATEGORIES = Object.freeze([
  StudyCategory.GENAI,
  StudyCategory.CODING,
  StudyCategory.ENGLISH,
  StudyCategory.OTHER,
]);