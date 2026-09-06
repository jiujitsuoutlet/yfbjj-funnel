import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { defaultDocument } from '../src/editor/defaults.js';
import { renderContentDocument } from '../src/editor/renderer.js';
import { validateContentDocument } from '../src/editor/schema.js';
import { upgradeContentDocument } from '../src/editor/upgrade.js';
import { EDITOR_IMAGE_PATHS } from '../src/editor/images.js';

function elements(document) {
  return document.sections.flatMap((section) => section.rows.flatMap((row) => row.columns.flatMap((column) => column.elements)));
}

test('version 1 published pages upgrade without resetting editor content', () => {
  const current = defaultDocument('thanks-granted');
  const old = structuredClone(current);
  old.version = 1;
  for (const column of old.sections.flatMap((section) => section.rows.flatMap((row) => row.columns))) {
    column.elements = column.elements.filter((element) => element.type !== 'accessLink');
  }
  const upgraded = upgradeContentDocument('thanks-granted', old);
  assert.equal(upgraded.version, 2);
  assert.equal(elements(upgraded).filter((element) => element.type === 'accessLink').length, 1);
  assert.equal(validateContentDocument(upgraded, { pageKey: 'thanks-granted', imagePaths: EDITOR_IMAGE_PATHS }).ok, true);
});

test('landing upgrade uses verified proof in a separate responsive section', () => {
  const document = defaultDocument('landing-a');
  const types = elements(document).map((element) => element.type);
  assert.ok(types.includes('quote'));
  assert.ok(types.includes('video'));
  assert.equal(document.sections.length, 2);
  assert.match(JSON.stringify(document), /15,000\+ BJJ athletes/);
  assert.equal(elements(document).find((element) => element.type === 'backgroundImage').flipHorizontal, true);
  assert.equal(validateContentDocument(document, { pageKey: 'landing-a', imagePaths: EDITOR_IMAGE_PATHS }).ok, true);
});

test('membership offer upgrades with an editable Yoga for BJJ image', () => {
  const source = defaultDocument('offer-two-month');
  const membershipImages = elements(source).filter((element) => element.id === 'offer-two-membership-image');
  assert.equal(membershipImages.length, 1);
  assert.equal(membershipImages[0].src, '/img/membership-shoulders-1600-v1.webp');
  assert.equal(validateContentDocument(source, { pageKey: 'offer-two-month', imagePaths: EDITOR_IMAGE_PATHS }).ok, true);
  const rendered = renderContentDocument(source, { pageKey: 'offer-two-month' }).body;
  assert.match(rendered, /membership-shoulders-1600-v1\.webp/);
  assert.ok(rendered.indexOf('offer-two-heading') < rendered.indexOf('offer-two-membership-image'));
  assert.ok(rendered.indexOf('offer-two-membership-image') < rendered.indexOf('offer-two-copy'));
});

test('lifetime offer reserves the coaching photo for certification', () => {
  const source = defaultDocument('offer-lifetime');
  source.sections[0].rows[0].columns[0].elements.splice(1, 0, {
    id: 'image-6e4b5e79',
    type: 'image',
    src: '/media/60cdaeb9-fd0b-4427-bb8f-71c4da9f9cb5',
    alt: 'Sebastian coaching grapplers.',
  });
  const upgraded = upgradeContentDocument('offer-lifetime', source);
  const replacement = elements(upgraded).find((element) => element.id === 'image-6e4b5e79');
  assert.equal(replacement.src, '/img/lifetime-twist-chair-cta-v1.webp');
  assert.match(replacement.alt, /Get Lifetime Access Now/);
  assert.equal(validateContentDocument(upgraded, { pageKey: 'offer-lifetime', imagePaths: EDITOR_IMAGE_PATHS }).ok, true);

  const previouslyUpgraded = structuredClone(upgraded);
  elements(previouslyUpgraded).find((element) => element.id === 'image-6e4b5e79').src = '/img/lifetime-twist-chair-1600-v1.webp';
  const currentReplacement = elements(upgradeContentDocument('offer-lifetime', previouslyUpgraded)).find((element) => element.id === 'image-6e4b5e79');
  assert.equal(currentReplacement.src, '/img/lifetime-twist-chair-cta-v1.webp');
});

test('renderer exposes a locked course access action and approved video', () => {
  const granted = renderContentDocument(defaultDocument('thanks-granted'), { pageKey: 'thanks-granted' });
  assert.match(granted.body, /href="https:\/\/yfbjj\.autocreator\.ai\/login"/);
  assert.match(granted.body, /data-access-link/);
  const landing = renderContentDocument(defaultDocument('landing-a'), { pageKey: 'landing-a' });
  assert.match(landing.body, /iframe\.mediadelivery\.net/);
  assert.match(landing.body, /editor-background is-flipped/);
});

test('conversion and managed media migration is complete and constrained', () => {
  const migration = fs.readFileSync(new URL('../migrations/0010_conversion_and_media.sql', import.meta.url), 'utf8');
  for (const table of ['conversion_events', 'conversion_rate_limits', 'editor_media']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /byte_length <= 768000/);
  assert.match(migration, /access_click/);
});

test('schema rejects unapproved video and image sources', () => {
  const video = defaultDocument('landing-a');
  elements(video).find((element) => element.type === 'video').src = 'https://example.com/embed';
  assert.equal(validateContentDocument(video, { pageKey: 'landing-a', imagePaths: EDITOR_IMAGE_PATHS }).ok, false);
  const image = defaultDocument('landing-a');
  elements(image).find((element) => element.type === 'backgroundImage').src = 'https://example.com/image.jpg';
  assert.equal(validateContentDocument(image, { pageKey: 'landing-a', imagePaths: EDITOR_IMAGE_PATHS }).ok, false);
});
