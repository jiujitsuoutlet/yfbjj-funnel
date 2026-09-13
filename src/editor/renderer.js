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
const INTRO_VIDEO_PATH = '/embed/215008/ad1f2932-955f-4abf-85d0-01c6a065a289';
const INTRO_VIDEO_MP4 = '/video/yoga-for-bjj-intro.mp4';
const INTRO_VIDEO_POSTER = '/video/yoga-for-bjj-intro.jpg';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function styleAttribute(style = {}, global = {}, pageKey = '') {
  const css = [];
  const px = (property, value) => {
    if (value === undefined) return;
    const number = Number(value);
    const safe = pageKey.startsWith('offer-') && ['margin-top', 'margin-bottom'].includes(property)
      ? Math.max(0, number)
      : number;
    css.push(`${property}:${safe}px`);
  };
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
  if (pageKey === 'offer-head-to-toes') return '<p class="offer-price">$29</p><p class="dim">Click the red button to charge $29 to the card used for your original order. Your bank may occasionally ask you to confirm.</p>';
  if (pageKey === 'offer-lifetime') return '<p class="offer-price">$247 once</p><p class="dim">Click the red button to charge $247 to the card used for your original order. Your bank may occasionally ask you to confirm.</p>';
  if (pageKey === 'offer-certification') return '<p class="offer-price">$297 once</p><p class="dim">All three certification levels. Click the red button to charge $297 to the card used for your original order. Your bank may occasionally ask you to confirm.</p>';
  if (pageKey === 'offer-two-month') {
    const starts = context.trialEnd
      ? `${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(context.trialEnd))} UTC`
      : '30 days after you complete checkout';
    return `<p class="offer-price">$8 first month</p><p class="dim">Click the red button to charge $8 to the card used for your original order. Then $19.99 per month starting ${escapeHtml(starts)}, until canceled. Canceling stops future charges. Course access remains. Your bank may occasionally ask you to confirm.</p>`;
  }
  return '';
}

function functionalMarkup(element, pageKey, env, context) {
  if (element.type === 'checkoutForm') {
    const bumpCents = Number(env.HEAD_TO_TOES_BUMP_PRICE_CENTS || 900);
    const bumpPrice = `$${(bumpCents / 100).toFixed(bumpCents % 100 ? 2 : 0)}`;
    return `<form id="lead-form" class="lead-form" novalidate>
    <label for="email">${escapeHtml(element.label || 'Email address')}</label>
    <input id="email" name="email" type="email" autocomplete="email" placeholder="${escapeHtml(element.placeholder || 'you@example.com')}" required>
    <label class="order-bump" for="head-to-toes-bump">
      <input id="head-to-toes-bump" name="order_bump" type="checkbox" value="head_to_toes">
      <span><strong>${escapeHtml(element.bumpHeadline || 'Yes... add Head to Toes')} <b>+ ${escapeHtml(bumpPrice)}</b></strong><small>${escapeHtml(element.bumpDescription || 'Three guided, 15-minute mobility sessions for inflexible grapplers.')}</small></span>
    </label>
    <button id="lead-submit" class="cta" type="submit" data-cart="bundle">${escapeHtml(element.buttonText || 'Get the bundle')}</button>
    <p id="lead-msg" class="form-msg" aria-live="polite"></p>
    <p class="cta-note">${escapeHtml(element.note || '')}</p>
  </form>`;
  }
  if (element.type === 'offerActions') return `<div class="form-actions">
    <button class="cta" type="button" data-offer-accept>${escapeHtml(element.acceptText || 'Continue')}</button>
    <button class="decline" type="button" data-offer-skip>${escapeHtml(element.skipText || 'No thanks')}</button>
    <p class="faint" data-offer-status aria-live="polite"></p>
  </div>`;
  if (element.type === 'price') return priceMarkup(pageKey, env, context);
  if (element.type === 'accessLink') return `<a class="cta editor-access-link" href="https://yogaforbjj.net/login" data-access-link>${escapeHtml(element.label || 'Access your courses')}</a><p>This login page is always available. If your setup email expires, request a fresh link there. Already signed in? <a href="https://yogaforbjj.net/programs">Open your programs</a>, including any instructor courses you purchased.</p>`;
  if (element.type === 'legalFooter') return `<footer><p>Yoga for BJJ</p><nav aria-label="Legal and support">
    <a href="https://yfbjj.autocreator.ai/legal/terms">Terms</a> &middot;
    <a href="https://yfbjj.autocreator.ai/legal/privacy">Privacy</a> &middot;
    <a href="mailto:Sebastian@yogaforbjj.net">Support</a>
  </nav></footer>`;
  if (element.type === 'previewBanner') return '<div id="preview-banner" class="preview-banner" hidden>Preview build &middot; <strong>checkout not connected</strong></div>';
  return '';
}

function lifetimeQuickOfferMarkup(action, pageKey, env, context) {
  if (!action || pageKey !== 'offer-lifetime') return '';
  return `<div class="editor-element lifetime-quick-offer" data-commerce-repeat="lifetime-top">
    <div class="lifetime-quick-price">${priceMarkup(pageKey, env, context)}</div>
    ${functionalMarkup(action, pageKey, env, context)}
  </div>`;
}

function certificationQuickOfferMarkup(action, pageKey, env, context) {
  if (!action || pageKey !== 'offer-certification') return '';
  return `<div class="editor-element certification-quick-offer" data-commerce-repeat="certification-mid">
    <div class="certification-quick-price">${priceMarkup(pageKey, env, context)}</div>
    ${functionalMarkup(action, pageKey, env, context)}
  </div>`;
}

function renderElement(element, pageKey, env, context, global, lifetime = {}, certification = {}) {
  const attr = styleAttribute(element.style, global, pageKey);
  const cls = `${classes(element, 'editor-element')}${element.id === lifetime.heroImageId ? ' lifetime-hero-image' : ''}`;
  let body = '';
  if (['checkoutForm', 'offerActions', 'price', 'accessLink', 'legalFooter', 'previewBanner'].includes(element.type)) {
    body = functionalMarkup(element, pageKey, env, context);
  } else if (element.type === 'heading') {
    const level = [1, 2, 3].includes(element.level) ? element.level : 2;
    body = `<h${level}>${escapeHtml(element.content)}</h${level}>`;
  } else if (element.type === 'text') body = `<p>${escapeHtml(element.content)}</p>`;
  else if (element.type === 'list') body = `<ul>${element.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  else if (element.type === 'image') body = `<img src="${escapeHtml(element.src)}" alt="${escapeHtml(element.alt)}" loading="${element.id === lifetime.heroImageId ? 'eager' : 'lazy'}"${element.id === lifetime.heroImageId ? ' fetchpriority="high"' : ''}>`;
  else if (element.type === 'quote') body = `<blockquote><p>${escapeHtml(element.content)}</p><cite>${escapeHtml(element.attribution)}</cite></blockquote>`;
  else if (element.type === 'video') {
    let approvedIntro = false;
    try { approvedIntro = new URL(element.src).pathname === INTRO_VIDEO_PATH; } catch { /* schema reports invalid URLs */ }
    body = approvedIntro
      ? `<div class="editor-video"><video src="${INTRO_VIDEO_MP4}" poster="${INTRO_VIDEO_POSTER}" title="${escapeHtml(element.title)}" controls playsinline preload="metadata"></video></div>`
      : `<div class="editor-video"><iframe src="${escapeHtml(element.src)}" title="${escapeHtml(element.title)}" loading="lazy" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  else if (element.type === 'divider') body = '<hr>';
  else if (element.type === 'spacer') body = `<div aria-hidden="true" style="height:${Number(element.size)}px"></div>`;
  const quickOffer = element.id === lifetime.afterId
    ? lifetimeQuickOfferMarkup(lifetime.action, pageKey, env, context)
    : element.id === certification.afterId
      ? certificationQuickOfferMarkup(certification.action, pageKey, env, context)
      : '';
  return `<div class="${cls}" data-editor-id="${escapeHtml(element.id)}"${attr}>${body}</div>${quickOffer}`;
}

export function renderContentDocument(document, { pageKey, env = {}, context = {} } = {}) {
  const global = document.globalStyles || {};
  const allElements = document.sections.flatMap((section) => section.rows.flatMap((row) => row.columns.flatMap((column) => column.elements)));
  const heroImageIndex = pageKey === 'offer-lifetime' ? allElements.findIndex((element) => element.type === 'image') : -1;
  const nextHeadingIndex = heroImageIndex >= 0
    ? allElements.findIndex((element, index) => index > heroImageIndex && element.type === 'heading')
    : -1;
  const lifetimeIntro = heroImageIndex >= 0
    ? allElements.slice(heroImageIndex + 1, nextHeadingIndex >= 0 ? nextHeadingIndex : undefined)
    : [];
  const lifetime = heroImageIndex >= 0 ? {
    heroImageId: allElements[heroImageIndex].id,
    afterId: [...lifetimeIntro].reverse().find((element) => element.type === 'text' && /⬇/.test(element.content || ''))?.id
      || [...lifetimeIntro].reverse().find((element) => element.type === 'text')?.id,
    action: allElements.find((element) => element.type === 'offerActions'),
  } : {};
  const certificationTarget = pageKey === 'offer-certification'
    ? allElements.find((element) => ['heading', 'text'].includes(element.type)
      && (element.id === 'heading-cfbc444a'
        || /grab\s+our\s+entire\s+3(?:\s|-)+part\s+instructor\s+certification\s+program\s+for\s+a\s+crazy\s+deal/i.test(element.content || '')))
    : null;
  const certification = certificationTarget ? {
    afterId: certificationTarget.id,
    action: allElements.find((element) => element.type === 'offerActions'),
  } : {};
  const announcement = allElements.find((element) => element.type === 'announcement');
  const background = (section) => section.rows.flatMap((row) => row.columns.flatMap((column) => column.elements)).find((element) => element.type === 'backgroundImage');
  const sections = document.sections.map((section) => `<section class="${classes(section, 'editor-section')}" data-editor-id="${escapeHtml(section.id)}"${styleAttribute(section.style, global, pageKey)}>
    ${background(section) ? `<picture class="editor-background${background(section).flipHorizontal ? ' is-flipped' : ''}"><img src="${escapeHtml(background(section).src)}" alt="${escapeHtml(background(section).alt)}" loading="eager" fetchpriority="high"></picture>` : ''}
    <div class="editor-section-inner">
      ${section.rows.map((row) => `<div class="${classes(row, 'editor-row')}" data-editor-id="${escapeHtml(row.id)}"${styleAttribute(row.style, global, pageKey)}>
        ${row.columns.map((column) => `<div class="${classes(column, 'editor-column')}" data-editor-id="${escapeHtml(column.id)}" style="--editor-column:${Number(column.width)};${styleAttribute(column.style, global, pageKey).replace(/^ style="|"$/g, '')}">
          ${column.elements.filter((element) => !['announcement', 'backgroundImage', 'previewBanner', 'legalFooter'].includes(element.type)).map((element) => renderElement(element, pageKey, env, context, global, lifetime, certification)).join('')}
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
    body: `<div class="editor-page" data-page-key="${escapeHtml(pageKey)}" style="${variables}">${announcement ? `<div class="announce">${escapeHtml(announcement.content)}</div>` : ''}${allElements.some((element) => element.type === 'previewBanner') ? functionalMarkup({ type: 'previewBanner' }, pageKey, env, context) : ''}${sections}${allElements.some((element) => element.type === 'legalFooter') ? functionalMarkup({ type: 'legalFooter' }, pageKey, env, context) : ''}</div>`,
  };
}
