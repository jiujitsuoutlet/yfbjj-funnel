const INTRO_VIDEO = 'https://iframe.mediadelivery.net/embed/215008/ad1f2932-955f-4abf-85d0-01c6a065a289?autoplay=false&loop=false&muted=false&preload=true&responsive=true&controls=true';

function allElements(document) {
  return document.sections.flatMap((section) => section.rows.flatMap((row) => row.columns.flatMap((column) => column.elements)));
}

function primary(document) { return document.sections[0].rows[0].columns[0].elements; }

function insertBefore(elements, beforeType, additions) {
  const index = elements.findIndex((element) => element.type === beforeType);
  elements.splice(index < 0 ? elements.length : index, 0, ...additions);
}

export function upgradeContentDocument(pageKey, input) {
  const document = structuredClone(input);
  if (!document || ![1, 2].includes(document.version)) return document;
  document.version = 2;
  const existing = new Set(allElements(document).map((element) => element.id));
  const add = (target, element, before = 'legalFooter') => {
    if (!existing.has(element.id)) insertBefore(target, before, [element]);
  };
  if (pageKey.startsWith('landing-')) {
    for (const element of allElements(document)) {
      if (element.type === 'backgroundImage' && element.flipHorizontal === undefined) element.flipHorizontal = true;
      if (element.type === 'checkoutForm') {
        if (element.bumpHeadline === undefined) element.bumpHeadline = 'Yes... add Head to Toes';
        if (element.bumpDescription === undefined) {
          element.bumpDescription = 'Three guided, 15-minute mobility sessions for inflexible grapplers.';
        }
      }
    }
    if (!document.sections.some((section) => section.id === `${pageKey}-proof-section`)) {
      document.sections.push({
        id: `${pageKey}-proof-section`, name: 'Proof and introduction', preset: 'none',
        style: { backgroundColor: 'black', paddingTop: 48, paddingBottom: 48 },
        rows: [{ id: `${pageKey}-proof-row`, name: 'Proof', style: { gap: 32, alignItems: 'center' }, columns: [
          { id: `${pageKey}-proof-copy`, name: 'Proof', width: 5, elements: [
            { id: `${pageKey}-proof`, type: 'text', preset: 'offerSummary', content: 'Trusted by 15,000+ BJJ athletes | 90+ programs | 30+ years on the mats' },
            { id: `${pageKey}-quote`, type: 'quote', content: 'My guard retention improved dramatically.', attribution: 'Yoga for BJJ member' },
          ] },
          { id: `${pageKey}-proof-video`, name: 'Video', width: 7, elements: [
            { id: `${pageKey}-video`, type: 'video', src: INTRO_VIDEO, title: 'Yoga for BJJ introduction' },
          ] },
        ] }],
      });
    }
  }
  if (pageKey === 'offer-lifetime') {
    const coachingImage = allElements(document).find((element) =>
      element.id === 'image-6e4b5e79'
      && element.type === 'image'
      && element.src === '/media/60cdaeb9-fd0b-4427-bb8f-71c4da9f9cb5'
    );
    if (coachingImage) {
      coachingImage.src = '/img/lifetime-twist-chair-1600-v1.webp';
      coachingImage.alt = 'Sebastian Brosche practicing a standing twist in the Yoga for BJJ studio.';
    }
  }
  const offerFacts = {
    'offer-head-to-toes': ['3 guided videos', 'About 15 minutes per session', 'Gentle movements built for inflexible grapplers'],
    'offer-lifetime': ['The full Yoga for BJJ library', '90+ programs and 1,200+ videos', '7 coaches and new content added regularly'],
    'offer-two-month': ['The full Yoga for BJJ library', '$8 for the first month', '$19.99 per month after that unless canceled', 'Canceling stops future charges. Course access remains.'],
    'offer-certification': ['Levels 1, 2 and 3', 'Class planning and sequencing', 'Communication, demonstration and BJJ-relevant anatomy'],
  };
  if (pageKey === 'offer-two-month' && !existing.has('offer-two-membership-image')) {
    const elements = primary(document);
    const headingIndex = elements.findIndex((element) => element.type === 'heading');
    elements.splice(headingIndex < 0 ? 0 : headingIndex + 1, 0, {
      id: 'offer-two-membership-image',
      type: 'image',
      src: '/img/membership-shoulders-1600-v1.webp',
      alt: 'Sebastian Brosche practicing downward-facing dog in Yoga for BJJ training gear.',
    });
  }
  if (offerFacts[pageKey]) add(primary(document), { id: `${pageKey}-facts`, type: 'list', preset: 'valueList', items: offerFacts[pageKey] }, 'price');
  if (pageKey === 'thanks-granted' || pageKey === 'thanks-activation') {
    add(primary(document), { id: `${pageKey}-access`, type: 'accessLink', label: 'Access your courses' });
  }
  return document;
}
