import { isFunctionalElement } from './schema.js';

const clone = (value) => structuredClone(value);
function walk(document, visitor) {
  for (const section of document.sections) for (const row of section.rows) for (const column of row.columns) {
    for (let index = 0; index < column.elements.length; index++) if (visitor(column.elements[index], column, index)) return true;
  }
  return false;
}
export function deleteElement(document, id) {
  const next = clone(document); let changed = false;
  walk(next, (element, column, index) => {
    if (element.id !== id) return false;
    if (isFunctionalElement(element.type)) return true;
    column.elements.splice(index, 1); changed = true; return true;
  });
  return { document: next, changed };
}
export function duplicateElement(document, id, newId) {
  const next = clone(document); let changed = false;
  walk(next, (element, column, index) => {
    if (element.id !== id) return false;
    if (isFunctionalElement(element.type)) return true;
    column.elements.splice(index + 1, 0, { ...clone(element), id: newId }); changed = true; return true;
  });
  return { document: next, changed };
}
export function moveElement(document, id, targetColumnId, targetIndex) {
  const next = clone(document); let moving;
  walk(next, (element, column, index) => {
    if (element.id !== id) return false;
    [moving] = column.elements.splice(index, 1); return true;
  });
  if (!moving) return { document: next, changed: false };
  for (const section of next.sections) for (const row of section.rows) for (const column of row.columns) if (column.id === targetColumnId) {
    column.elements.splice(Math.max(0, Math.min(targetIndex, column.elements.length)), 0, moving);
    return { document: next, changed: true };
  }
  return { document: clone(document), changed: false };
}
export function addElement(document, columnId, element, index = Infinity) {
  const next = clone(document);
  for (const section of next.sections) for (const row of section.rows) for (const column of row.columns) if (column.id === columnId) {
    column.elements.splice(Math.min(index, column.elements.length), 0, clone(element)); return { document: next, changed: true };
  }
  return { document: next, changed: false };
}
function layoutOperation(document, kind, id, operation) {
  const next = clone(document);
  const lists = kind === 'section' ? [next.sections]
    : kind === 'row' ? next.sections.map((section) => section.rows)
      : next.sections.flatMap((section) => section.rows.map((row) => row.columns));
  for (const list of lists) {
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) return { document: next, changed: operation(list, index) !== false };
  }
  return { document: next, changed: false };
}
export function moveLayout(document, kind, id, direction) {
  return layoutOperation(document, kind, id, (list, index) => {
    const target = index + direction; if (target < 0 || target >= list.length) return false;
    [list[index], list[target]] = [list[target], list[index]];
  });
}
export function duplicateLayout(document, kind, id, rekey) {
  return layoutOperation(document, kind, id, (list, index) => {
    const copy = clone(list[index]);
    const visit = (node) => { if (node.id) node.id = rekey(node.id); for (const key of ['rows', 'columns', 'elements']) for (const child of node[key] || []) visit(child); };
    visit(copy);
    const hasFunctional = JSON.stringify(copy).match(/"type":"(checkoutForm|offerActions|price|legalFooter|previewBanner)"/);
    if (hasFunctional) return false;
    list.splice(index + 1, 0, copy);
  });
}
export function deleteLayout(document, kind, id) {
  return layoutOperation(document, kind, id, (list, index) => {
    if (list.length <= 1 || JSON.stringify(list[index]).match(/"type":"(checkoutForm|offerActions|price|legalFooter|previewBanner)"/)) return false;
    list.splice(index, 1);
  });
}
export function resizeColumns(document, rowId, widths) {
  const next = clone(document);
  if (!Array.isArray(widths) || widths.some((width) => !Number.isInteger(width) || width < 1 || width > 12) || widths.reduce((a, b) => a + b, 0) !== 12) return { document: next, changed: false };
  for (const section of next.sections) for (const row of section.rows) if (row.id === rowId && row.columns.length === widths.length) {
    row.columns.forEach((column, index) => { column.width = widths[index]; }); return { document: next, changed: true };
  }
  return { document: next, changed: false };
}
export function history(initial) {
  return { past: [], present: clone(initial), future: [] };
}
export function applyHistory(state, document) { return { past: [...state.past, state.present].slice(-50), present: clone(document), future: [] }; }
export function undo(state) {
  if (!state.past.length) return state;
  return { past: state.past.slice(0, -1), present: clone(state.past.at(-1)), future: [state.present, ...state.future].slice(0, 50) };
}
export function redo(state) {
  if (!state.future.length) return state;
  return { past: [...state.past, state.present].slice(-50), present: clone(state.future[0]), future: state.future.slice(1) };
}
