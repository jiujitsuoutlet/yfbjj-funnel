# EXC-69 first-draft rejection

Baseline reviewed: protected visual staging revision `22a62727090da900e93e07cbcf7a502bf21a8542`.
The durable baseline captures are in `artifacts/before/`. The matching second-pass
captures are in `artifacts/after/`. Each set covers both variants, `/thanks`, and
`/preview-checkout` at 375, 768, 1024, and 1440 pixels.

## Why the first draft is rejected

1. **First-screen clarity.** The headline had the right problem, but the product,
   eight-item scope, price, email step, and non-subscription terms competed inside
   an undifferentiated column. At 768 through 1440 the composition still behaved
   like a stretched phone page.
2. **Brand and polish.** The measured black, red, uppercase Arial system was
   present, but repeated same-width bands, identical cards, and identical section
   rhythm made the page feel assembled from a template. Large screens left useful
   visual space idle rather than using the approved photography and offer panel as
   a deliberate composition.
3. **Responsive composition.** The 375 layout was serviceable. The 768, 1024, and
   1440 captures showed no overflow, but they did not create a meaningful tablet or
   desktop hierarchy. Utility pages used legacy class names with no corresponding
   layout rules, so their rhythm was visibly disconnected from the funnel.
4. **Conversion sequence.** `$14` appeared in copy and on the button, but it was
   not a dominant visual fact beside the eight-collection scope. Post-purchase
   pages opened with interchangeable urgency bars rather than explaining the
   progression from guard, to whole body, to library, to teaching. The downsell
   left its renewal timing as a visible placeholder.
5. **Copy.** Variant B is intentionally longer, but its many same-shaped paragraphs
   create a slow middle. Both variants repeat the price and subscription objection
   without a compact first-screen offer summary. Secondary pages did not always
   name why the next offer follows the previous purchase.
6. **Accessibility and behavior.** Baseline browser runs at all four widths found
   no console errors or horizontal overflow. Existing focus rings, reduced-motion
   behavior, minimum control heights, image dimensions, and neutral small text are
   sound and must be preserved. Preview staging, however, needs an explicit no-D1
   state so review traffic cannot touch stateful handlers when D1 is intentionally
   absent.
7. **Consistency.** Landing pages used the brand components. `/thanks` and
   `/preview-checkout` did not share their spacing. ThriveCart pages shared CSS but
   their announcements did not communicate a coherent step-to-step narrative.

## Defect-to-change map

| Defect | Implemented change |
| --- | --- |
| Product and price are not one first-screen unit | Added a high-contrast offer panel that pairs Guard Retention Bundle, `$14`, eight collections, the email field, CTA, and payment terms. |
| Desktop is a stretched mobile column | Added a 70rem canvas, constrained reading measure, a two-column hero from 768px, responsive type, and two-up collection cards where space permits. |
| Generic repeated card rhythm | Introduced an editorial hero composition, restrained elevation, asymmetric photographic space, and clearer section density while keeping measured brand tokens. |
| Offer ladder feels disconnected | Rewrote each ThriveCart announcement and eyebrow as an explicit progression: guard, whole body, complete library, teaching. |
| Downsell terms are incomplete | States the verified timing in the introduction, benefit list, and price block: `$8` for two months, then `$20/month` from month three until cancellation. |
| Anniversary context is weak | Names the verified 14th anniversary on the landing hero and lifetime offer. |
| Utility pages are visually detached | Added shared main, section, footer, heading, and spacing rules. |
| Visual staging has no D1 | Added `PREVIEW_NO_D1=true`; visits are not counted and health, lead, and stats endpoints stop before any D1 access. Checkout remains preview-only. |
| Browser evidence is manual and easy to lose | Added a Playwright audit that saves the full matrix and fails on console errors, page errors, HTTP errors, broken images, or horizontal overflow. |

## Deliberate deferrals and unverified items

- Support email, Terms, Privacy, Head to Toes scope, certification level details,
  and the certification video remain marked placeholders. No client facts were
  invented to hide those gaps.
- ThriveCart accept and decline URLs remain builder-owned placeholders. This pass
  does not claim to verify one-click charging, fulfillment, or the live transition
  between ThriveCart steps.
- No protected staging deployment was performed. Deployment requires a separate,
  explicit operator instruction. The `artifacts/after/` matrix is the local Worker.
- Variant B remains intentionally long. This pass improves its composition and
  first screen without erasing the test's short-form versus long-form distinction.
