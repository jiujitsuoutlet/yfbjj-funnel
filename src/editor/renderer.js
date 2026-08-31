const PRESET_CLASSES = Object.freeze({
  none: '', landingHero: 'editor-preset-landing-hero', heroCopy: 'editor-preset-hero-copy',
  heroOffer: 'editor-preset-hero-offer', identity: 'editor-preset-identity', lede: 'lede',
  valueList: 'checks', bonusLine: 'editor-preset-bonus', offerSummary: 'editor-preset-offer-summary',
  support: 'editor-preset-support',
});
const COLOR = Object.freeze({
  black: 'var(--black)', black2: 'var(--black-2)', cream: 'var(--cream)', white: 'var(--white)',
  dim: 'var(--ink-2)', red: 'var(--red)',
});
const FONT = Object.freeze({ brandSans: 'var(--stack)', systemSans: 'Arial,Helvetica,sans-serif', serif: 'Georgia,serif' });
const JUSTIFY = Object.freeze({ start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' });
const ALIGN = Object.freeze({ start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' });

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function styleAttribute(style = {}, global = {}) {
  const css = [];
  const px = (property, value) => { if (value !== undefined) css.push(`${property}:${Number(value)}px`); };
  if (style.fontFamily) css.push(`font-family:${FONT[style.fontFamily]}`);
  px('font-size', style.fontSize);
  if (style.fontWeight) css.push(`font-weight:${style.fontWeight}`);
  if (style.lineHeight) css.push(`line-height:${style.lineHeight}`);
  px('letter-spacing', style.letterSpacing);
  if (style.textAlign) css.push(`text-align:${style.textAlign}`);
  if (style.textTransform) css.push(`text-transform:${style.textTransform}`);
  if (style.color) css.push(`color:${COLOR[style.color]}`);
  if (style.backgroundColor) css.push(`background-color:${COLOR[style.backgroundColor]}`);
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    px(`padding-${side.toLowerCase()}`, style[`padding${side}`]);
    px(`margin-${side.toLowerCase()}`, style[`margin${side}`]);
  }
  px('gap', style.gap); px('border-radius', style.radius); px('max-width', style.maxWidth); px('min-height', style.minHeight);
  if (style.opacity !== undefined) css.push(`opacity:${style.opacity}`);
  if (style.alignItems) css.push(`align-items:${ALIGN[style.alignItems]}`);
  if (style.justifyContent) css.push(`justify-content:${JUSTIFY[style.justifyContent]}`);
  if (global.maxWidth && !style.maxWidth) css.push(`--editor-max-width:${Number(global.maxWidth)}px`);
  return css.length ? ` style="${css.join(';')}"` : '';
}

function classes(node, base) {
  const out = [base];
  if (node.preset && PRESET_CLASSES[node.preset]) out.push(PRESET_CLASSES[node.preset]);
  for (const device of node.hiddenOn || []) out.push(`editor-hide-${device}`);
  return out.filter(Boolean).join(' ');
}

function priceMarkup(pageKey, env, context) {
  if (pageKey.startsWith('landing-')) {
    const cents = Number(env.BUNDLE_PRICE_CENTS || 1400);
    return `<p class="offer-price" data-price="bundle">$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}</p>`;
  }
  if (pageKey === 'offer-head-to-toes') return '<p class="offer-price">$29</p><p class="dim">One-time purchase. Confirm in Stripe Checkout.</p>';
  if (pageKey === 'offer-lifetime') return '<p class="offer-price">$247 once</p><p class="dim">One-time purchase. Confirm in Stripe Checkout.</p>';
  if (pageKey === 'offer-two-month') {
    const starts = context.trialEnd
      ? `${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(context.trialEnd))} UTC`
      : 'two calendar months after checkout';
    return `<p class="offer-price">$8 today</p><p class="dim">Then $19.99 per month starting ${escapeHtml(starts)}, until canceled. Stripe shows the same terms before confirmation.</p>`;
  }
  return '';
}

function functionalMarkup(element, pageKey, env, context) {
  if (element.type === 'checkoutForm') return `<form id="lead-form" class="lead-form" novalidate>
    <label for="email">${escapeHtml(element.label || 'Email address')}</label>
    <input id="email" name="email" type="email" autocomplete="email" placeholder="${escapeHtml(element.placeholder || 'you@example.com')}" required>
    <button id="lead-submit" class="cta" type="submit" data-cart="bundle">${escapeHtml(element.buttonText || 'Get the bundle')}</button>
    <p id="lead-msg" class="form-msg" aria-live="polite"></p>
    <p class="cta-note">${escapeHtml(element.note || '')}</p>
  </form>`;
  if (element.type === 'offerActions') return `<div class="form-actions">
    <button class="cta" type="button" data-offer-accept>${escapeHtml(element.acceptText || 'Continue')}</button>
    <button class="decline" type="button" data-offer-skip>${escapeHtml(element.skipText || 'No thanks')}</button>
    <p class="faint" data-offer-status aria-live="polite"></p>
  </div>`;
  if (element.type === 'price') return priceMarkup(pageKey, env, context);
  if (element.type === 'legalFooter') return `<footer><p>Yoga for BJJ</p><nav aria-label="Legal and support">
    <a href="https://yfbjj.autocreator.ai/legal/terms">Terms</a> &middot;
    <a href="https://yfbjj.autocreator.ai/legal/privacy">Privacy</a> &middot;
    <a href="mailto:Sebastian@yogaforbjj.net">Support</a>
  </nav></footer>`;
  if (element.type === 'previewBanner') return '<div id="preview-banner" class="preview-banner" hidden>Preview build &middot; <strong>checkout not connected</strong></div>';
  return '';
}

function renderElement(element, pageKey, env, context, global) {
  const attr = styleAttribute(element.style, global);
  const cls = classes(element, 'editor-element');
  let body = '';
  if (['checkoutForm', 'offerActions', 'price', 'legalFooter', 'previewBanner'].includes(element.type)) {
    body = functionalMarkup(element, pageKey, env, context);
  } else if (element.type === 'heading') {
    const level = [1, 2, 3].includes(element.level) ? element.level : 2;
    body = `<h${level}>${escapeHtml(element.content)}</h${level}>`;
  } else if (element.type === 'text') body = `<p>${escapeHtml(element.content)}</p>`;
  else if (element.type === 'list') body = `<ul>${element.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  else if (element.type === 'image') body = `<img src="${escapeHtml(element.src)}" alt="${escapeHtml(element.alt)}" loading="lazy">`;
  else if (element.type === 'divider') body = '<hr>';
  else if (element.type === 'spacer') body = `<div aria-hidden="true" style="height:${Number(element.size)}px"></div>`;
  return `<div class="${cls}" data-editor-id="${escapeHtml(element.id)}"${attr}>${body}</div>`;
}

export function renderContentDocument(document, { pageKey, env = {}, context = {} } = {}) {
  const global = document.globalStyles || {};
  const allElements = document.sections.flatMap((section) => section.rows.flatMap((row) => row.columns.flatMap((column) => column.elements)));
  const announcement = allElements.find((element) => element.type === 'announcement');
  const background = (section) => section.rows.flatMap((row) => row.columns.flatMap((column) => column.elements)).find((element) => element.type === 'backgroundImage');
  const sections = document.sections.map((section) => `<section class="${classes(section, 'editor-section')}" data-editor-id="${escapeHtml(section.id)}"${styleAttribute(section.style, global)}>
    ${background(section) ? `<picture class="editor-background"><img src="${escapeHtml(background(section).src)}" alt="${escapeHtml(background(section).alt)}" loading="eager" fetchpriority="high"></picture>` : ''}
    <div class="editor-section-inner">
      ${section.rows.map((row) => `<div class="${classes(row, 'editor-row')}" data-editor-id="${escapeHtml(row.id)}"${styleAttribute(row.style, global)}>
        ${row.columns.map((column) => `<div class="${classes(column, 'editor-column')}" data-editor-id="${escapeHtml(column.id)}" style="--editor-column:${Number(column.width)};${styleAttribute(column.style, global).replace(/^ style="|"$/g, '')}">
          ${column.elements.filter((element) => !['announcement', 'backgroundImage', 'previewBanner', 'legalFooter'].includes(element.type)).map((element) => renderElement(element, pageKey, env, context, global)).join('')}
        </div>`).join('')}
      </div>`).join('')}
    </div>
  </section>`).join('');
  const variables = [
    `--editor-page-bg:${COLOR[global.backgroundColor]}`,
    `--editor-body-color:${COLOR[global.bodyColor]}`,
    `--editor-heading-color:${COLOR[global.headingColor]}`,
    `--editor-accent-color:${COLOR[global.accentColor]}`,
    `--editor-page-font:${FONT[global.fontFamily]}`,
    `--editor-page-width:${Number(global.maxWidth)}px`,
    `--editor-button-radius:${Number(global.buttonRadius)}px`,
  ].join(';');
  return {
    title: escapeHtml(document.seo && document.seo.title || 'Yoga for BJJ'),
    description: escapeHtml(document.seo && document.seo.description || ''),
    body: `<div class="editor-page" style="${variables}">${announcement ? `<div class="announce">${escapeHtml(announcement.content)}</div>` : ''}${allElements.some((element) => element.type === 'previewBanner') ? functionalMarkup({ type: 'previewBanner' }, pageKey, env, context) : ''}${sections}${allElements.some((element) => element.type === 'legalFooter') ? functionalMarkup({ type: 'legalFooter' }, pageKey, env, context) : ''}</div>`,
  };
}
