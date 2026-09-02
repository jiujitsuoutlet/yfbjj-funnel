import { EDITOR_PAGE_KEYS } from './schema.js';

const globalStyles = Object.freeze({
  backgroundColor: 'black', bodyColor: 'white', headingColor: 'white', accentColor: 'red',
  fontFamily: 'brandSans', maxWidth: 1120, buttonRadius: 32,
});

function element(id, type, extra = {}) { return { id, type, ...extra }; }
function documentFor(pageKey, title, description, elements, preset = 'landingHero') {
  return {
    version: 1,
    seo: { title, description },
    globalStyles: { ...globalStyles },
    sections: [{
      id: `${pageKey}-section`, name: 'Main', preset,
      style: { backgroundColor: 'black2', paddingTop: 48, paddingBottom: 48 },
      rows: [{
        id: `${pageKey}-row`, name: 'Content', style: { gap: 24, alignItems: 'center' },
        columns: [{ id: `${pageKey}-column`, name: 'Primary', width: 12, elements }],
      }],
    }],
  };
}

function landingDocument(pageKey, headline) {
  return {
    version: 1,
    seo: { title: 'The Guard Retention Bundle | Yoga for BJJ', description: 'Eight mobility collections built around one problem: keeping your guard. $14, one time.' },
    globalStyles: { ...globalStyles },
    sections: [{
      id: `${pageKey}-section`, name: 'Guard Retention hero', preset: 'landingHero',
      style: { backgroundColor: 'black2', minHeight: 640 },
      rows: [{ id: `${pageKey}-row`, name: 'Hero columns', style: { gap: 40, alignItems: 'center' }, columns: [
        { id: `${pageKey}-copy`, name: 'Offer copy', width: 8, elements: [
          element(`${pageKey}-announcement`, 'announcement', { content: 'Mobility for Brazilian Jiu-Jitsu athletes.' }),
          preview(pageKey),
          element(`${pageKey}-identity`, 'text', { preset: 'identity', content: 'Yoga for BJJ' }),
          element(`${pageKey}-heading`, 'heading', { level: 1, preset: 'heroCopy', content: headline }),
          element(`${pageKey}-lede`, 'text', { preset: 'lede', content: "This isn't another technique instructional. It's mobility work built around keeping your guard." }),
          element(`${pageKey}-values`, 'list', { preset: 'valueList', items: [
            'Never get your guard passed again with our Guard Flexibility program',
            'Master every guard position in our Guard Program',
            'Achieve flexibility you never thought you could with our Inverted Guard program',
            'Unlock the hips that every single one of those positions runs through with our Hip Program',
            "Start exactly where you are, even if you can't sit cross-legged, with our Stiffest Hips program",
            'Kill that pinch in the front of your hip with our Hip Flexor Rehab program',
            'Touch your toes for the first time since high school with our Stiffest Legs program',
          ] }),
          element(`${pageKey}-bonus-transition`, 'text', { content: "And for those of you who think you're too busy to do any of this?" }),
          element(`${pageKey}-bonus`, 'text', { preset: 'bonusLine', content: 'We are also giving you access to our "Im too busy for Yoga... but i need it!" program' }),
          element(`${pageKey}-image`, 'backgroundImage', { src: '/img/guard-pass-800.webp', alt: "A black and white competition photo of one grappler passing another grappler's guard." }),
        ] },
        { id: `${pageKey}-offer`, name: 'Checkout', width: 4, elements: [
          element(`${pageKey}-summary`, 'text', { preset: 'offerSummary', content: 'Guard Retention Bundle | 8 mobility collections' }),
          element(`${pageKey}-price`, 'price'),
          element(`${pageKey}-form`, 'checkoutForm', { label: 'Where should we send it?', placeholder: 'you@example.com', buttonText: 'Get the bundle', note: 'One payment. Not a subscription. Optional offers come next.' }),
          legal(pageKey),
        ] },
      ] }],
    }],
  };
}

const legal = (key) => element(`${key}-legal`, 'legalFooter');
const preview = (key) => element(`${key}-preview`, 'previewBanner');

const documents = {
  'landing-a': landingDocument('landing-a', 'Keep your guard. Get your hips back.'),
  'landing-b': landingDocument('landing-b', "Your guard isn't the problem. Your hips are."),
  'offer-head-to-toes': documentFor('offer-head-to-toes', 'Head to Toes', 'Optional post-purchase offer.', [
    element('offer-head-heading', 'heading', { level: 1, content: 'Add Head to Toes.' }),
    element('offer-head-copy', 'text', { preset: 'lede', content: 'Keep this separate from your Guard Retention purchase. Choose it only if you want it.' }),
    element('offer-head-price', 'price'), element('offer-head-actions', 'offerActions', { acceptText: 'Add Head to Toes', skipText: 'No thanks. Show me the next option.' }), legal('offer-head-to-toes'),
  ]),
  'offer-lifetime': documentFor('offer-lifetime', 'Lifetime access', 'Optional post-purchase offer.', [
    element('offer-life-heading', 'heading', { level: 1, content: 'Choose lifetime access.' }),
    element('offer-life-copy', 'text', { preset: 'lede', content: 'This is a separate one-time purchase.' }),
    element('offer-life-price', 'price'), element('offer-life-actions', 'offerActions', { acceptText: 'Choose lifetime', skipText: 'No thanks. Show me the lower-cost option.' }), legal('offer-lifetime'),
  ]),
  'offer-two-month': documentFor('offer-two-month', '$8 first month', 'Optional lower-cost offer.', [
    element('offer-two-heading', 'heading', { level: 1, content: 'Start your first month for $8.' }),
    element('offer-two-copy', 'text', { preset: 'lede', content: 'Then it continues at $19.99 per month unless you cancel. Canceling stops future charges. Your course access remains.' }),
    element('offer-two-price', 'price'), element('offer-two-actions', 'offerActions', { acceptText: 'Start for $8', skipText: 'No thanks. Show me the final option.' }), legal('offer-two-month'),
  ]),
  'offer-certification': documentFor('offer-certification', 'Instructor certification', 'Final optional post-purchase offer.', [
    element('offer-cert-heading', 'heading', { level: 1, content: 'Teach Yoga for BJJ.' }),
    element('offer-cert-copy', 'text', { preset: 'lede', content: 'Levels 1, 2 and 3. This is for coaches and prospective coaches who intend to teach this material to grapplers.' }),
    element('offer-cert-price', 'price'), element('offer-cert-actions', 'offerActions', { acceptText: 'Get all three levels for $297', skipText: 'No thanks. Finish my order.' }), legal('offer-certification'),
  ]),
  'thanks-preview': documentFor('thanks-preview', 'Checkout preview', 'Preview state.', [preview('thanks-preview'), element('thanks-preview-heading', 'heading', { level: 1, content: 'Checkout is locked.' }), element('thanks-preview-copy', 'text', { content: 'No payment or access change happened in this preview.' }), legal('thanks-preview')], 'support'),
  'thanks-pending': documentFor('thanks-pending', 'Order processing', 'Pending order state.', [element('thanks-pending-heading', 'heading', { level: 1, content: 'We are checking your order.' }), element('thanks-pending-copy', 'text', { content: 'Access has not been confirmed yet. This page will only say you are in after the entitlement grant is durably recorded.' }), element('thanks-pending-support', 'text', { preset: 'support', content: 'If this is still pending after 15 minutes, write to Sebastian@yogaforbjj.net with your Stripe receipt.' }), legal('thanks-pending')], 'support'),
  'thanks-failed': documentFor('thanks-failed', 'Payment not completed', 'Failed order state.', [element('thanks-failed-heading', 'heading', { level: 1, content: 'Your order needs attention.' }), element('thanks-failed-copy', 'text', { content: 'Access was not granted. Return to the offer and try checkout again.' }), element('thanks-failed-support', 'text', { preset: 'support', content: 'Questions? Write to Sebastian@yogaforbjj.net.' }), legal('thanks-failed')], 'support'),
  'thanks-granted': documentFor('thanks-granted', 'Access granted', 'Granted order state.', [element('thanks-granted-heading', 'heading', { level: 1, content: "You're in." }), element('thanks-granted-copy', 'text', { content: 'Payment is complete and your access grant is durably recorded.' }), element('thanks-granted-support', 'text', { preset: 'support', content: 'Sign in to Yoga for BJJ to use your access. If anything looks wrong, write to Sebastian@yogaforbjj.net with your Stripe receipt.' }), legal('thanks-granted')], 'support'),
  'thanks-activation': documentFor('thanks-activation', 'Activate your access', 'Activation-needed order state.', [element('thanks-activation-heading', 'heading', { level: 1, content: 'Your access is assigned.' }), element('thanks-activation-copy', 'text', { content: 'Payment is complete. Your Yoga for BJJ access is assigned, but this account has not signed in yet.' }), element('thanks-activation-support', 'text', { preset: 'support', content: 'Open Yoga for BJJ and use the email from checkout to sign in. If you need help, write to Sebastian@yogaforbjj.net with your Stripe receipt.' }), legal('thanks-activation')], 'support'),
  'preview-checkout': documentFor('preview-checkout', 'Checkout is not connected yet', 'Preview checkout state.', [preview('preview-checkout'), element('preview-checkout-heading', 'heading', { level: 1, content: 'Checkout is not connected yet' }), element('preview-checkout-copy', 'text', { content: 'On the live page, this button opens a Stripe-hosted checkout. This preview cannot create a session, customer, payment, subscription, or entitlement.' }), element('preview-checkout-detail', 'heading', { level: 2, content: 'What happens when it goes live' }), element('preview-checkout-list', 'list', { preset: 'valueList', items: ['The email address is captured first', 'The buyer lands on Stripe Checkout', 'Access follows the verified offer mapping'] }), element('preview-checkout-locks', 'text', { content: 'Checkout stays locked until preflight verifies the Stripe prices, AutoCreator grant keys, deadline, D1 database, and fulfillment implementation.' }), legal('preview-checkout')], 'support'),
};

export const DEFAULT_PAGE_DOCUMENTS = Object.freeze(documents);
export function defaultDocument(pageKey) {
  if (!EDITOR_PAGE_KEYS.includes(pageKey)) return null;
  return structuredClone(DEFAULT_PAGE_DOCUMENTS[pageKey]);
}
