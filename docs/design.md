# Design system

Hireproof is a work tool. Recruiters scan many candidate profiles a day, so the score, the evidence quoted from the CV and the next action carry the hierarchy. Client hiring managers read on phones, so the portal is designed at 375px first. Light theme only.

The tokens live in `apps/web/src/app/tokens.css` as a Tailwind v4 `@theme` block. Components read them as utilities (`bg-card`, `text-muted-foreground`, `rounded-md`). No component carries a literal colour.

## Direction

- Warm paper instead of white or cool grey, with near-black ink. It reads calmer over a long day and keeps the product away from the default blue-and-slate look of most SaaS tools.
- One accent, tangerine, used as a fill with dark ink on it: the primary action and the current selection. It is never used as text colour, so it cannot be confused with a link or a warning.
- Density comes from small, consistent type and ruled lists rather than cards. Panels have a 1px border and no shadow. Only floating layers (menus, popovers) are lifted.
- Scores and counts are set in a monospaced face with tabular figures, so columns of numbers line up while scanning.
- Nothing decorative: no gradients, no icons used as ornament, no animation beyond a short colour transition on controls.

## Colour

Values are shown in sRGB hex for reference. The source of truth is the OKLCH value in `tokens.css`.

| Token                              | Hex                   | Use                                                              |
| ---------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `background`                       | `#f5f1ea`             | Page background                                                  |
| `card`                             | `#fffdfa`             | Panels, inputs, popovers                                         |
| `muted`, `accent`                  | `#e9e4d9`             | Sunken areas, hover on quiet controls                            |
| `foreground`                       | `#14110f`             | Primary text                                                     |
| `muted-foreground`                 | `#58514c`             | Secondary text, placeholders                                     |
| `border`                           | `#dbd7ce`             | Rules and panel borders                                          |
| `input`                            | `#8c857f`             | Input and outlined button borders                                |
| `primary`                          | `#fc6b33`             | Accent fill, with `foreground` ink on top                        |
| `primary-soft`                     | `#fed8c4`             | Selected row or tab background                                   |
| `ring`                             | `#d84a00`             | Focus ring                                                       |
| `success` / `success-soft`         | `#09672e` / `#d4f1d8` | Done, in date, strong match                                      |
| `warning` / `warning-soft`         | `#754b00` / `#fbeabe` | Needs attention, not an error                                    |
| `destructive` / `destructive-soft` | `#b7191c` / `#ffe4e1` | Errors and destructive actions                                   |
| `review` / `review-soft`           | `#225899` / `#dbe9fc` | AI output that is uncertain and must be confirmed by a recruiter |

`review` is deliberately a different hue from every other state. It marks a decision the recruiter still owes, so it should never read as an error or as a success. Pair it with a text label ("Needs review"), never colour alone.

shadcn naming note: `primary` is the product accent. shadcn's `accent` token is only the hover surface for quiet controls.

Contrast, measured: body text on the page 16.7:1, secondary text on the page 6.9:1, ink on the accent fill 6.5:1, input border on the card 3.6:1, focus ring on the page 3.8:1, each state colour on its soft fill 5.5:1 or better.

## Type

Three Red Hat families through `next/font`, which self-hosts them at build time:

- Red Hat Display 600 for page and section headings, tracking -0.02em.
- Red Hat Text 400 and 500 for everything else. Labels are the body face, a step smaller, sentence case, untracked.
- Red Hat Mono for scores, counts and anything copied onto a form, with tabular figures (the `.num` class).

Scale, ratio 1.2 from a 16px body. Body text is never smaller than 16px.

| Token               | Size     | Use                         |
| ------------------- | -------- | --------------------------- |
| `text-xs`           | 0.75rem  | Fine print, badges          |
| `text-sm`           | 0.875rem | Labels, table text, buttons |
| `text-md`           | 1rem     | Body                        |
| `text-lg`           | 1.2rem   | Section headings            |
| `text-xl` (display) | 1.44rem  | Page titles                 |
| `text-2xl`          | 1.728rem | Reserved for large figures  |

## Spacing, radius, elevation

- Spacing follows the Tailwind 4px grid. Named steps in `tokens.css`: 8, 12, 16, 24, 40, 64. Page gutter is 24px, 16px under 40rem.
- Radius: 4px for badges, 6px for controls, 10px for panels. Nothing is rounder.
- Shadow: one token, `shadow-pop`, for menus and popovers.
- Motion: a 120ms colour transition on controls, nothing else. `prefers-reduced-motion` collapses it.

## Controls

- Buttons are 40px tall on desktop and 44px on touch devices (`pointer-coarse`). The `lg` size is 44px everywhere and is used in the client portal.
- One filled button per screen: the primary action. Secondary actions are outlined, tertiary are ghost.
- Inputs match the button height, always have a visible label, and show errors inline under the field with `aria-invalid` and a described-by link.
- Focus is a 2px outline in `ring`, offset 2px, shown instantly on keyboard focus.
- Disabled controls use 55% opacity, `not-allowed` cursor and the native attribute.

## Candidate screens

- The requisition page has two tabs, Scorecard and Candidates, as a tab strip with a ruled bottom edge. The current tab takes `primary-soft` and a 2px `primary` underline. The tab is kept in the URL (`?tab=candidates`).
- Upload is a dashed panel, not a modal. Progress is a native `progress` bar with a text label. Per-file status is a label plus its plain reason, never colour alone. The finished file list collapses into a disclosure so the candidate list stays in view.
- The candidate list is a dense table from 48rem and stacked rows below it. Flags (Scan, Needs review, Possible duplicate) are text labels. Needs review uses the `review` colour, a possible duplicate uses `warning`.
- A possible duplicate is shown as two panels side by side, "This CV" and "Already on file", with the same rows in each so differences read across. The two actions sit under both, and "Same person" is the filled button.
- Review reasons on the profile are a list in `review` on `review-soft`, headed by the words "Needs review".

## Voice

Plain and specific, in the staffing firm's own words: requisition, shortlist, notice period, CTC. Empty states say what belongs there and what fills it, in a full sentence with a full stop. No exclamation marks, no marketing verbs.
