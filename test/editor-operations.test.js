import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDocument } from '../src/editor/defaults.js';
import { addElement, deleteElement, duplicateElement, history, moveElement, moveLayout, redo, resizeColumns, undo } from '../src/editor/operations.js';

test('element operations move across columns while commerce blocks cannot be deleted or duplicated', () => {
  const document = defaultDocument('landing-a');
  const [copy, offer] = document.sections[0].rows[0].columns;
  const textId = copy.elements.find((item) => item.type === 'heading').id;
  const checkoutId = offer.elements.find((item) => item.type === 'checkoutForm').id;
  const moved = moveElement(document, textId, offer.id, 0);
  assert.equal(moved.changed, true);
  assert.equal(moved.document.sections[0].rows[0].columns[1].elements[0].id, textId);
  assert.equal(moveElement(document, checkoutId, copy.id, 0).changed, true);
  assert.equal(deleteElement(document, checkoutId).changed, false);
  assert.equal(duplicateElement(document, checkoutId, 'bad-copy').changed, false);
  assert.equal(addElement(document, copy.id, { id: 'new-text', type: 'text', content: 'New' }).changed, true);
});

test('layout movement, valid column sizing, and undo redo are deterministic', () => {
  const document = defaultDocument('thanks-pending');
  document.sections.push({ id: 'second-section', name: 'Second', preset: 'none', rows: [{ id: 'second-row', columns: [{ id: 'second-column', width: 12, elements: [{ id: 'second-text', type: 'text', content: 'Second' }] }] }] });
  const moved = moveLayout(document, 'section', 'second-section', -1);
  assert.equal(moved.changed, true);
  assert.equal(moved.document.sections[0].id, 'second-section');
  assert.equal(resizeColumns(document, 'thanks-pending-row', [12]).changed, true);
  assert.equal(resizeColumns(document, 'thanks-pending-row', [11]).changed, false);
  const state = history(document);
  const undone = undo({ past: [document], present: moved.document, future: [] });
  assert.equal(undone.present.sections[0].id, document.sections[0].id);
  assert.equal(redo(undone).present.sections[0].id, 'second-section');
  assert.equal(state.past.length, 0);
});
