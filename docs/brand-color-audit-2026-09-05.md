# Brand color audit ... 2026-09-05

Reference: https://yogaforbjj.net/, inspected in a real browser using computed styles.

Measured CTA gradient: #dc2626 to #e02020. Light sections: #f3f4ee. Main dark ground: #0a0a0a. Dark secondary sections: #0d0d10. White type on dark; near-black type on light. Arial/Helvetica font stack.

The live base stylesheet already contained these tokens. The editor used different red, cream, black, and font values, and displayed generic gray disabled buttons. New normal-flow offer documents also lacked the main site's light/dark contrast.

Changes: shared brand stylesheet for live and editor; exact editor palette; matching preview CTA gradient; off-white default for offer sections without an explicit owner background; dark benefit panels and red rules. Explicit owner section backgrounds remain authoritative. No stored content, media, prices, payment behavior, or live configuration changed.

Verification: existing 60 tests passed; 2 new brand tests passed; preflight and its secret scan passed. Local rendered certification fixture: measured colors match reference; 1280px and 375px layouts have no horizontal overflow; image loaded. This is a representative style fixture, not the full current D1 page. No paid checkout test or production deployment performed.

Production deployment requires explicit instruction under this repository's AGENTS.md. Current result is built locally, not live. The pending main-branch order-bump changes must be considered when selecting the production release revision.
