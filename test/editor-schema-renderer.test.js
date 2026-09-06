import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PAGE_DOCUMENTS, defaultDocument } from '../src/editor/defaults.js';
import { EDITOR_PAGE_KEYS, validateContentDocument } from '../src/editor/schema.js';
import { renderContentDocument } from '../src/editor/renderer.js';

const images = ['/img/guard-pass-800.webp'];

test('all fixed page defaults pass strict schema invariants', () => {
  for (const pageKey of EDITOR_PAGE_KEYS) {
    const result = validateContentDocument(DEFAULT_PAGE_DOCUMENTS[pageKey], { pageKey, imagePaths: images });
    assert.equal(result.ok, true, `${pageKey}: ${result.errors.join('; ')}`);
  }
});

test('schema rejects unsafe fields, blank layouts, bad columns, and duplicate IDs', () => {
  const unsafe = defaultDocument('landing-a');
  unsafe.sections[0].rows[0].columns[0].elements[1].rawHTML = '<script>alert(1)</script>';
  assert.match(validateContentDocument(unsafe, { pageKey: 'landing-a', imagePaths: images }).errors.join(' '), /unknown field/);

  const blank = defaultDocument('thanks-pending');
  blank.sections = [];
  assert.match(validateContentDocument(blank, { pageKey: 'thanks-pending' }).errors.join(' '), /at least one section/);

  const widths = defaultDocument('thanks-pending');
  widths.sections[0].rows[0].columns[0].width = 11;
  assert.match(validateContentDocument(widths, { pageKey: 'thanks-pending' }).errors.join(' '), /total 12/);

  const duplicate = defaultDocument('thanks-pending');
  duplicate.sections[0].rows[0].columns[0].elements[1].id = duplicate.sections[0].id;
  assert.match(validateContentDocument(duplicate, { pageKey: 'thanks-pending' }).errors.join(' '), /duplicate ID/);
});

test('page-specific commerce components cannot be deleted, duplicated, or moved across page kinds', () => {
  const landing = defaultDocument('landing-a');
  const offerColumn = landing.sections[0].rows[0].columns[1].elements;
  offerColumn.splice(offerColumn.findIndex((item) => item.type === 'checkoutForm'), 1);
  assert.match(validateContentDocument(landing, { pageKey: 'landing-a', imagePaths: images }).errors.join(' '), /exactly 1 checkoutForm/);

  const offer = defaultDocument('offer-lifetime');
  offer.sections[0].rows[0].columns[0].elements.push({ id: 'bad-checkout', type: 'checkoutForm' });
  assert.match(validateContentDocument(offer, { pageKey: 'offer-lifetime' }).errors.join(' '), /exactly 0 checkoutForm/);

  const duplicate = defaultDocument('offer-lifetime');
  duplicate.sections[0].rows[0].columns[0].elements.push({ id: 'second-action', type: 'offerActions' });
  assert.match(validateContentDocument(duplicate, { pageKey: 'offer-lifetime' }).errors.join(' '), /exactly 1 offerActions/);
});

test('renderer escapes content and derives locked prices and actions from server context', () => {
  const document = defaultDocument('offer-two-month');
  document.sections[0].rows[0].columns[0].elements[0].content = '<script>charge()</script>';
  document.sections[0].rows[0].columns[0].elements.find((item) => item.type === 'offerActions').acceptText = '<img onerror=charge()>Confirm';
  const rendered = renderContentDocument(document, {
    pageKey: 'offer-two-month', context: { trialEnd: '2027-03-31T12:00:00.000Z' }, env: { STRIPE_PRICE_TWO_MONTH: 'price_secret' },
  });
  assert.doesNotMatch(rendered.body, /<script>charge/);
  assert.match(rendered.body, /&lt;script&gt;charge\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.body, /price_secret/);
  assert.match(rendered.body, /\$8 first month/);
  assert.match(rendered.body, /March 31, 2027/);
  assert.match(rendered.body, /data-offer-accept/);
  assert.match(rendered.body, /--editor-page-bg/);
});

test('Certification editor page keeps the $297 price server-owned', () => {
  const document = defaultDocument('offer-certification');
  assert.equal(validateContentDocument(document, { pageKey: 'offer-certification', imagePaths: images }).ok, true);
  const rendered = renderContentDocument(document, {
    pageKey: 'offer-certification', env: { STRIPE_PRICE_CERTIFICATION: 'price_secret' },
  }).body;
  assert.match(rendered, /\$297 once/);
  assert.match(rendered, /All three certification levels/);
  assert.doesNotMatch(rendered, /price_secret/);
});

test('lifetime page repeats one safe purchase action after its opening image copy', () => {
  const document = defaultDocument('offer-lifetime');
  const column = document.sections[0].rows[0].columns[0];
  column.elements.splice(1, 0,
    { id: 'lifetime-hero', type: 'image', src: '/img/lunge-wide-keep-reading-v1.webp', alt: 'Sebastian stretching' },
    { id: 'lifetime-opening', type: 'text', content: 'Keep reading.' },
    { id: 'lifetime-arrow', type: 'text', content: 'Choose below. ⬇️' },
  );
  const rendered = renderContentDocument(document, {
    pageKey: 'offer-lifetime',
  }).body;
  assert.match(rendered, /lifetime-hero-image/);
  assert.match(rendered, /data-commerce-repeat="lifetime-top"/);
  assert.equal((rendered.match(/data-offer-accept/g) || []).length, 2);
  assert.equal((rendered.match(/data-offer-skip/g) || []).length, 2);
  assert.equal((rendered.match(/\$247 once/g) || []).length, 2);
  assert.ok(rendered.indexOf('Choose below. ⬇️') < rendered.indexOf('data-commerce-repeat="lifetime-top"'));
});

test('landing defaults preserve the current offer copy before first publish', () => {
  for (const pageKey of ['landing-a', 'landing-b']) {
    const serialized = JSON.stringify(DEFAULT_PAGE_DOCUMENTS[pageKey]);
    assert.match(serialized, /Guard Flexibility program/);
    assert.match(serialized, /Stiffest Legs program/);
    assert.match(serialized, /Im too busy for Yoga/);
    assert.match(serialized, /8 mobility collections/);
    assert.match(serialized, /One payment\. Not a subscription\. Optional offers come next\./);
    const rendered = renderContentDocument(DEFAULT_PAGE_DOCUMENTS[pageKey], { pageKey, env: { BUNDLE_PRICE_CENTS: '1400', HEAD_TO_TOES_BUMP_PRICE_CENTS: '900' } }).body;
    assert.match(rendered, /Mobility for Brazilian Jiu-Jitsu athletes\./);
    assert.match(rendered, /class="editor-background(?: is-flipped)?"/);
    assert.match(rendered, /\/img\/guard-pass-800\.webp/);
    assert.match(rendered, /class="announce"/);
    assert.match(rendered, /id="lead-form"/);
    assert.match(rendered, /id="head-to-toes-bump"/);
    assert.match(rendered, /Yes\.\.\. add Head to Toes/);
    assert.match(rendered, /\+ \$9/);
    assert.doesNotMatch(rendered, /price_secret/);
  }
});
