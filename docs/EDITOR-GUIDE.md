# Yoga for BJJ visual editor

The editor is available at `/admin/editor` after migration `0008` and the
`ADMIN_PASSWORD` Cloudflare Secret are configured. The secret must be a unique,
generated high-entropy value.

## Editing

Choose one of the fixed pages, then select a layer or canvas element. Text,
lists, checked-in images, typography, palette colors, and spacing use a strict
allowlist. Use the layout controls to move sections, rows, columns, and
elements. The inspector also provides keyboard and touch-friendly move buttons.
Desktop, tablet, and mobile buttons resize the canvas.

Draft changes autosave after a short pause. **Save draft** forces an immediate
save. Drafts are private. **Publish** saves the current draft and creates an
immutable version before making that revision public. History restore copies an
older version into a new draft revision, so it still needs an explicit publish.

## Locked behavior

Checkout forms, displayed prices, offer actions, legal links, and preview
banners are functional components. Their routes, actions, prices, identifiers,
and behavior come from server code. They cannot be deleted or duplicated.
There is no raw HTML, CSS, JavaScript, arbitrary URL, route, price ID,
entitlement key, secret, or deployment setting control.

Public requests read only published JSON. Missing tables, query errors, absent
published content, invalid JSON, and unsupported schemas all serve the compiled
source page instead. Editor storage is not part of the commerce health gate.

## Sessions

Sessions last eight hours and use an HttpOnly, Secure, SameSite=Strict host
cookie. Mutations require the session, exact same Origin, JSON content type,
and a separate CSRF token. Login allows five attempts per IP bucket in fifteen
minutes. Log out when finished.
