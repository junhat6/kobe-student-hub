---
version: 1
slug: "src-account-registration-tsx"
primary_target: "src/account/Registration.tsx"
related_targets: ["src/account/AccountPage.tsx","src/account/account.css"]
---

# Ordinary registration and private account

Mode: Operate. Scope: extend the existing private two-year account form and current app shell to ordinary signup/login/account routes. PRODUCT.md records already answered product facts; DESIGN.md remains the incumbent authority. This is a precisely specified form extension, so no open concept choice or new visual world is introduced.

## Direction contract

THESIS: A student enters only two private academic years and explicitly continues to school Google; returning users can sign in without entering those years again. The account page confirms stored state rather than inferring success from a redirect.

OWN-WORLD: Inherit the current blue links, white form surface, pale app background, system Japanese text, 8px inputs and 44px controls. Use the existing AccountEnrollment visual language and clear labels. No decorative illustration, raster, metric or extra identity field.

STORY: Understand that the years remain private; enter and validate them; start Google once; return to a fixed clean account route; see confirmed session and saved years or an explicit recovery action. Retain the existing session conceal/continuation discipline.

FIRST VIEWPORT: Within the app shell, one concise heading, short privacy explanation, two vertically grouped year fields with the March-graduation example, a primary school Google action, and a quiet existing-login link. Mobile uses the same single reading order without a sidebar. Account view places verification state before the existing year form.

FORM: Existing account form extension, code-led. A precisely specified narrow task under the existing design system; concept-seed is not applicable. Signature interaction: unknown starts or changed sessions preserve safe state and require explicit confirmation rather than a second automatic Google attempt.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Evidence constraints: synthetic browser provider only, no real enrollment claims, no new trial/lab, no release flag activation, no private feedback publication. No shipping raster assets are required. Finish with separate independent behavior/visual review and an incumbent-system documentation check.
