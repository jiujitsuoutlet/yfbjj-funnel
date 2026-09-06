export const EDITOR_PAGE_KEYS = Object.freeze([
  'landing-a', 'landing-b',
  'offer-head-to-toes', 'offer-lifetime', 'offer-two-month', 'offer-certification',
  'thanks-preview', 'thanks-pending', 'thanks-failed', 'thanks-granted', 'thanks-activation',
  'preview-checkout',
]);

const PAGE_KEYS = new Set(EDITOR_PAGE_KEYS);
const ELEMENT_TYPES = new Set([
  'heading', 'text', 'list', 'image', 'quote', 'video', 'divider', 'spacer',
  'checkoutForm', 'offerActions', 'price', 'accessLink', 'legalFooter', 'previewBanner', 'announcement', 'backgroundImage',
]);
const FUNCTIONAL_TYPES = new Set(['checkoutForm', 'offerActions', 'price', 'accessLink', 'legalFooter', 'previewBanner', 'announcement', 'backgroundImage']);
const FUNCTIONAL_RULES = Object.freeze({
  'landing-a': { checkoutForm: 1, price: 1, legalFooter: 1, previewBanner: 1, announcement: 1, backgroundImage: 1 },
  'landing-b': { checkoutForm: 1, price: 1, legalFooter: 1, previewBanner: 1, announcement: 1, backgroundImage: 1 },
  'offer-head-to-toes': { offerActions: 1, price: 1, legalFooter: 1 },
  'offer-lifetime': { offerActions: 1, price: 1, legalFooter: 1 },
  'offer-two-month': { offerActions: 1, price: 1, legalFooter: 1 },
  'offer-certification': { offerActions: 1, price: 1, legalFooter: 1 },
  'thanks-preview': { legalFooter: 1, previewBanner: 1 },
  'thanks-pending': { legalFooter: 1 },
  'thanks-failed': { legalFooter: 1 },
  'thanks-granted': { accessLink: 1, legalFooter: 1 },
  'thanks-activation': { accessLink: 1, legalFooter: 1 },
  'preview-checkout': { legalFooter: 1, previewBanner: 1 },
});
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PALETTE = new Set(['black', 'black2', 'cream', 'white', 'dim', 'red']);
const DEVICES = new Set(['desktop', 'tablet', 'mobile']);
const STYLE_KEYS = new Set([
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform',
  'color', 'backgroundColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap', 'radius', 'maxWidth',
  'minHeight', 'opacity', 'alignItems', 'justifyContent',
]);
const PRESETS = new Set(['none', 'landingHero', 'heroCopy', 'heroOffer', 'identity', 'lede', 'valueList', 'bonusLine', 'offerSummary', 'support']);
const ROOT_KEYS = new Set(['version', 'seo', 'globalStyles', 'sections']);
const SEO_KEYS = new Set(['title', 'description']);
const GLOBAL_KEYS = new Set(['backgroundColor', 'bodyColor', 'headingColor', 'accentColor', 'fontFamily', 'maxWidth', 'buttonRadius']);
const SECTION_KEYS = new Set(['id', 'name', 'preset', 'hiddenOn', 'style', 'rows']);
const ROW_KEYS = new Set(['id', 'name', 'hiddenOn', 'style', 'columns']);
const COLUMN_KEYS = new Set(['id', 'name', 'width', 'hiddenOn', 'style', 'elements']);
const ELEMENT_KEYS = Object.freeze({
  heading: new Set(['id', 'type', 'preset', 'content', 'level', 'style', 'hiddenOn']),
  text: new Set(['id', 'type', 'preset', 'content', 'style', 'hiddenOn']),
  list: new Set(['id', 'type', 'preset', 'items', 'style', 'hiddenOn']),
  image: new Set(['id', 'type', 'preset', 'src', 'alt', 'style', 'hiddenOn']),
  quote: new Set(['id', 'type', 'preset', 'content', 'attribution', 'style', 'hiddenOn']),
  video: new Set(['id', 'type', 'preset', 'src', 'title', 'style', 'hiddenOn']),
  divider: new Set(['id', 'type', 'preset', 'style', 'hiddenOn']),
  spacer: new Set(['id', 'type', 'preset', 'size', 'hiddenOn']),
  checkoutForm: new Set(['id', 'type', 'preset', 'label', 'placeholder', 'note', 'buttonText', 'bumpHeadline', 'bumpDescription', 'style', 'hiddenOn']),
  offerActions: new Set(['id', 'type', 'preset', 'acceptText', 'skipText', 'style', 'hiddenOn']),
  price: new Set(['id', 'type', 'preset', 'style', 'hiddenOn']),
  accessLink: new Set(['id', 'type', 'preset', 'label', 'style', 'hiddenOn']),
  legalFooter: new Set(['id', 'type', 'preset', 'style', 'hiddenOn']),
  previewBanner: new Set(['id', 'type', 'preset', 'style', 'hiddenOn']),
  announcement: new Set(['id', 'type', 'content', 'preset', 'style']),
  backgroundImage: new Set(['id', 'type', 'src', 'alt', 'flipHorizontal', 'preset', 'style']),
});

function issue(errors, path, message) { errors.push(`${path}: ${message}`); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function unknownKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) issue(errors, `${path}.${key}`, 'unknown field');
}
function string(value, path, errors, max = 5000, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    issue(errors, path, `must be ${required ? 'a non-empty ' : ''}string up to ${max} characters`);
    return '';
  }
  return value;
}
function number(value, path, errors, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issue(errors, path, `must be a number from ${min} to ${max}`);
  }
}
function enumValue(value, allowed, path, errors) {
  if (!allowed.has(value)) issue(errors, path, `must be one of ${[...allowed].join(', ')}`);
}
function validateId(value, path, errors, ids) {
  if (typeof value !== 'string' || !ID_RE.test(value)) return issue(errors, path, 'invalid ID');
  if (ids.has(value)) return issue(errors, path, 'duplicate ID');
  ids.add(value);
}
function validateHidden(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => !DEVICES.has(item)) || new Set(value).size !== value.length) {
    issue(errors, path, 'must contain unique desktop, tablet, or mobile values');
  }
}

function validateStyle(style, path, errors) {
  if (style === undefined) return;
  if (!plain(style)) return issue(errors, path, 'must be an object');
  unknownKeys(style, STYLE_KEYS, path, errors);
  for (const [key, value] of Object.entries(style)) {
    if (key === 'fontFamily') enumValue(value, new Set(['brandSans', 'systemSans', 'serif']), `${path}.${key}`, errors);
    else if (key === 'fontSize') number(value, `${path}.${key}`, errors, 10, 96);
    else if (key === 'fontWeight') enumValue(value, new Set([400, 500, 700, 900]), `${path}.${key}`, errors);
    else if (key === 'lineHeight') number(value, `${path}.${key}`, errors, 0.8, 2);
    else if (key === 'letterSpacing') number(value, `${path}.${key}`, errors, -4, 8);
    else if (key === 'textAlign') enumValue(value, new Set(['left', 'center', 'right']), `${path}.${key}`, errors);
    else if (key === 'textTransform') enumValue(value, new Set(['none', 'uppercase']), `${path}.${key}`, errors);
    else if (key === 'color' || key === 'backgroundColor') enumValue(value, PALETTE, `${path}.${key}`, errors);
    else if (key.startsWith('padding')) number(value, `${path}.${key}`, errors, 0, 160);
    else if (key.startsWith('margin')) number(value, `${path}.${key}`, errors, -160, 160);
    else if (key === 'gap') number(value, `${path}.${key}`, errors, 0, 96);
    else if (key === 'radius') number(value, `${path}.${key}`, errors, 0, 32);
    else if (key === 'maxWidth') number(value, `${path}.${key}`, errors, 280, 1440);
    else if (key === 'minHeight') number(value, `${path}.${key}`, errors, 0, 1200);
    else if (key === 'opacity') number(value, `${path}.${key}`, errors, 0.2, 1);
    else if (key === 'alignItems') enumValue(value, new Set(['start', 'center', 'end', 'stretch']), `${path}.${key}`, errors);
    else if (key === 'justifyContent') enumValue(value, new Set(['start', 'center', 'end', 'between']), `${path}.${key}`, errors);
  }
}

function validateElement(element, path, errors, ids, manifest) {
  if (!plain(element)) return issue(errors, path, 'must be an object');
  if (!ELEMENT_TYPES.has(element.type)) return issue(errors, `${path}.type`, 'unsupported element type');
  unknownKeys(element, ELEMENT_KEYS[element.type], path, errors);
  validateId(element.id, `${path}.id`, errors, ids);
  validateHidden(element.hiddenOn, `${path}.hiddenOn`, errors);
  validateStyle(element.style, `${path}.style`, errors);
  if (FUNCTIONAL_TYPES.has(element.type) && element.hiddenOn !== undefined) issue(errors, `${path}.hiddenOn`, 'locked functional elements cannot be hidden');
  if (FUNCTIONAL_TYPES.has(element.type) && element.style && element.style.opacity !== undefined) issue(errors, `${path}.style.opacity`, 'locked functional elements cannot change opacity');
  if ('preset' in element) enumValue(element.preset, PRESETS, `${path}.preset`, errors);
  if ('content' in element) string(element.content, `${path}.content`, errors, 10000, false);
  if ((element.type === 'heading' || element.type === 'text') && !Object.hasOwn(element, 'content')) {
    issue(errors, `${path}.content`, 'is required');
  }
  if (element.type === 'heading' && ![1, 2, 3].includes(element.level)) issue(errors, `${path}.level`, 'must be 1, 2, or 3');
  if (element.type === 'list') {
    if (!Array.isArray(element.items) || element.items.length > 50) issue(errors, `${path}.items`, 'must be an array of at most 50 items');
    else element.items.forEach((item, index) => string(item, `${path}.items[${index}]`, errors, 1000));
  }
  if (element.type === 'image' || element.type === 'backgroundImage') {
    string(element.src, `${path}.src`, errors, 300);
    string(element.alt, `${path}.alt`, errors, 500, false);
    if (!manifest.has(element.src)) issue(errors, `${path}.src`, 'must be an approved image path');
  }
  if (element.type === 'backgroundImage' && typeof element.flipHorizontal !== 'boolean') {
    issue(errors, `${path}.flipHorizontal`, 'must be true or false');
  }
  if (element.type === 'quote') {
    string(element.content, `${path}.content`, errors, 1000);
    string(element.attribution, `${path}.attribution`, errors, 200);
  }
  if (element.type === 'video') {
    string(element.src, `${path}.src`, errors, 500);
    string(element.title, `${path}.title`, errors, 200);
    let approved = false;
    try { approved = new URL(element.src).hostname === 'iframe.mediadelivery.net'; } catch { /* invalid */ }
    if (!approved) issue(errors, `${path}.src`, 'must be an approved Yoga for BJJ video URL');
  }
  if (element.type === 'announcement') string(element.content, `${path}.content`, errors, 500);
  if (element.type === 'spacer') number(element.size, `${path}.size`, errors, 0, 160);
  for (const key of ['label', 'placeholder', 'note', 'buttonText', 'bumpHeadline', 'bumpDescription', 'acceptText', 'skipText']) {
    if (key in element) string(element[key], `${path}.${key}`, errors, 500, false);
  }
}

export function validateContentDocument(input, { pageKey, imagePaths = [], maxBytes = 250_000 } = {}) {
  const errors = [];
  let bytes = Infinity;
  try { bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength; } catch { /* reported below */ }
  if (bytes > maxBytes) issue(errors, '$', `document exceeds ${maxBytes} bytes`);
  if (!PAGE_KEYS.has(pageKey)) issue(errors, '$.pageKey', 'unknown fixed page key');
  if (!plain(input)) return { ok: false, errors: [...errors, '$: must be an object'] };
  unknownKeys(input, ROOT_KEYS, '$', errors);
  if (input.version !== 2) issue(errors, '$.version', 'must equal 2');
  if (input.seo !== undefined) {
    if (!plain(input.seo)) issue(errors, '$.seo', 'must be an object');
    else {
      unknownKeys(input.seo, SEO_KEYS, '$.seo', errors);
      string(input.seo.title, '$.seo.title', errors, 120, false);
      string(input.seo.description, '$.seo.description', errors, 300, false);
    }
  }
  const globalStyles = input.globalStyles;
  if (!plain(globalStyles)) issue(errors, '$.globalStyles', 'must be an object');
  else {
    unknownKeys(globalStyles, GLOBAL_KEYS, '$.globalStyles', errors);
    for (const key of ['backgroundColor', 'bodyColor', 'headingColor', 'accentColor']) enumValue(globalStyles[key], PALETTE, `$.globalStyles.${key}`, errors);
    enumValue(globalStyles.fontFamily, new Set(['brandSans', 'systemSans', 'serif']), '$.globalStyles.fontFamily', errors);
    number(globalStyles.maxWidth, '$.globalStyles.maxWidth', errors, 280, 1440);
    number(globalStyles.buttonRadius, '$.globalStyles.buttonRadius', errors, 0, 32);
  }
  const sections = input.sections;
  if (!Array.isArray(sections) || sections.length > 50) issue(errors, '$.sections', 'must be an array of at most 50 sections');
  const ids = new Set();
  const manifest = new Set(imagePaths);
  let elementCount = 0;
  const functionalCounts = Object.fromEntries([...FUNCTIONAL_TYPES].map((type) => [type, 0]));
  if (!Array.isArray(sections) || sections.length < 1) issue(errors, '$.sections', 'must contain at least one section');
  if (Array.isArray(sections)) sections.forEach((section, si) => {
    const sp = `$.sections[${si}]`;
    if (!plain(section)) return issue(errors, sp, 'must be an object');
    unknownKeys(section, SECTION_KEYS, sp, errors);
    validateId(section.id, `${sp}.id`, errors, ids);
    if ('preset' in section) enumValue(section.preset, PRESETS, `${sp}.preset`, errors);
    if ('name' in section) string(section.name, `${sp}.name`, errors, 100, false);
    validateHidden(section.hiddenOn, `${sp}.hiddenOn`, errors);
    validateStyle(section.style, `${sp}.style`, errors);
    if (!Array.isArray(section.rows) || section.rows.length < 1 || section.rows.length > 20) return issue(errors, `${sp}.rows`, 'must contain 1 to 20 rows');
    section.rows.forEach((row, ri) => {
      const rp = `${sp}.rows[${ri}]`;
      if (!plain(row)) return issue(errors, rp, 'must be an object');
      unknownKeys(row, ROW_KEYS, rp, errors);
      validateId(row.id, `${rp}.id`, errors, ids);
      if ('name' in row) string(row.name, `${rp}.name`, errors, 100, false);
      validateHidden(row.hiddenOn, `${rp}.hiddenOn`, errors);
      validateStyle(row.style, `${rp}.style`, errors);
      if (!Array.isArray(row.columns) || row.columns.length < 1 || row.columns.length > 4) return issue(errors, `${rp}.columns`, 'must contain 1 to 4 columns');
      const widthTotal = row.columns.reduce((total, column) => total + (plain(column) && Number.isFinite(column.width) ? column.width : 0), 0);
      if (widthTotal !== 12) issue(errors, `${rp}.columns`, 'column widths must total 12');
      row.columns.forEach((column, ci) => {
        const cp = `${rp}.columns[${ci}]`;
        if (!plain(column)) return issue(errors, cp, 'must be an object');
        unknownKeys(column, COLUMN_KEYS, cp, errors);
        validateId(column.id, `${cp}.id`, errors, ids);
        if ('name' in column) string(column.name, `${cp}.name`, errors, 100, false);
        number(column.width, `${cp}.width`, errors, 1, 12);
        validateHidden(column.hiddenOn, `${cp}.hiddenOn`, errors);
        validateStyle(column.style, `${cp}.style`, errors);
        if (!Array.isArray(column.elements) || column.elements.length > 50) return issue(errors, `${cp}.elements`, 'must contain at most 50 elements');
        elementCount += column.elements.length;
        column.elements.forEach((element, ei) => {
          validateElement(element, `${cp}.elements[${ei}]`, errors, ids, manifest);
          if (plain(element) && FUNCTIONAL_TYPES.has(element.type)) functionalCounts[element.type] += 1;
        });
      });
    });
  });
  if (elementCount < 1) issue(errors, '$.sections', 'document must contain at least one element');
  if (elementCount > 1000) issue(errors, '$.sections', 'document contains too many elements');
  const required = FUNCTIONAL_RULES[pageKey] || {};
  for (const type of FUNCTIONAL_TYPES) {
    const expected = required[type] || 0;
    if (functionalCounts[type] !== expected) issue(errors, '$.sections', `page requires exactly ${expected} ${type} element${expected === 1 ? '' : 's'}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: structuredClone(input), errors: [] };
}

export function isFunctionalElement(type) { return FUNCTIONAL_TYPES.has(type); }
