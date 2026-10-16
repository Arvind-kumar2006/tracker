/**
 * Reflection domain tests — pure functions, no React, no emulator.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFLECTION_QUESTIONS,
  emptyReflectionForm,
  formToPayload,
  entryToForm,
  buildQualityViewModel,
} from '../src/domain/reflection.js';

test('REFLECTION_QUESTIONS has exactly 5 questions', () => {
  assert.equal(REFLECTION_QUESTIONS.length, 5);
});

test('REFLECTION_QUESTIONS have unique ids', () => {
  const ids = REFLECTION_QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, 5);
});

test('emptyReflectionForm returns all fields empty', () => {
  const form = emptyReflectionForm();
  assert.equal(form.floorHit, null);
  assert.equal(form.floorHitReason, '');
  assert.equal(form.accomplished, '');
  assert.equal(form.blockers, '');
  assert.equal(form.planBend, '');
  assert.equal(form.tomorrowChange, '');
});

test('formToPayload converts form to API payload', () => {
  const form = {
    floorHit: true,
    floorHitReason: 'Finished module 3',
    accomplished: 'Built RAG pipeline',
    blockers: 'Avoided phone',
    planBend: 'Started late',
    tomorrowChange: 'Start early',
  };

  const payload = formToPayload(form);
  assert.equal(payload.floorHit, true);
  assert.equal(payload.floorHitReason, 'Finished module 3');
  assert.equal(payload.accomplished, 'Built RAG pipeline');
  assert.equal(payload.blockers, 'Avoided phone');
  assert.equal(payload.planBend, 'Started late');
  assert.equal(payload.tomorrowChange, 'Start early');
});

test('formToPayload converts empty strings to null', () => {
  const form = emptyReflectionForm();
  const payload = formToPayload(form);
  assert.equal(payload.floorHitReason, null);
  assert.equal(payload.accomplished, null);
  assert.equal(payload.blockers, null);
  assert.equal(payload.planBend, null);
  assert.equal(payload.tomorrowChange, null);
});

test('entryToForm converts API entry to form state', () => {
  const entry = {
    floorHit: true,
    floorHitReason: 'Finished module 3',
    accomplished: 'Built RAG pipeline',
    blockers: 'Avoided phone',
    planBend: 'Started late',
    tomorrowChange: 'Start early',
  };

  const form = entryToForm(entry);
  assert.equal(form.floorHit, true);
  assert.equal(form.floorHitReason, 'Finished module 3');
  assert.equal(form.accomplished, 'Built RAG pipeline');
  assert.equal(form.blockers, 'Avoided phone');
  assert.equal(form.planBend, 'Started late');
  assert.equal(form.tomorrowChange, 'Start early');
});

test('entryToForm unwraps Mongo blocker objects', () => {
  const form = entryToForm({ blockers: { raw: 'Phone notifications interrupted the first block' } });
  assert.equal(form.blockers, 'Phone notifications interrupted the first block');
});

test('entryToForm handles missing entry', () => {
  const form = entryToForm(null);
  assert.equal(form.floorHit, null);
  assert.equal(form.floorHitReason, '');
});

test('buildQualityViewModel creates a view-model', () => {
  const report = {
    date: '2026-10-15',
    overallScore: 7,
    vagueCount: 1,
    isComplete: true,
    summary: 'Good reflection',
    fields: [
      { fieldId: 'floorHit', score: 9, isVague: false, reason: 'Clear', suggestion: null },
      { fieldId: 'accomplished', score: 8, isVague: false, reason: 'Specific', suggestion: null },
    ],
    droppedFields: [],
    followUpQuestions: [
      { fieldId: 'blockers', question: 'Name what you avoided AND what you did instead.' },
    ],
  };

  const vm = buildQualityViewModel(report);
  assert.equal(vm.date, '2026-10-15');
  assert.equal(vm.overallScore, 7);
  assert.equal(vm.tone, 'positive');
  assert.equal(vm.fields.length, 2);
  assert.equal(vm.followUpQuestions.length, 1);
});

test('buildQualityViewModel handles null report', () => {
  const vm = buildQualityViewModel(null);
  assert.equal(vm, null);
});

test('each question has a placeholder and hint', () => {
  for (const q of REFLECTION_QUESTIONS) {
    assert.ok(q.placeholder.length > 0, `${q.id} missing placeholder`);
    assert.ok(q.hint.length > 0, `${q.id} missing hint`);
    assert.ok(q.description.length > 0, `${q.id} missing description`);
  }
});
