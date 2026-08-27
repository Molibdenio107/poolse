# POOLSE-12 · Colourful weather icons in installation details

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Installations / Weather · **Priority:** Low

### PO — why this exists

The weather block on an installation page is glanced at, not read — staff want to know in half a second whether today is a rain day for an outdoor basin. Flat monochrome icons force people to read the label to tell cloud from rain. Low priority because nothing is broken, but it is a cheap, visible polish that also fixes an accessibility gap: the icons carry no text alternative today.

**Not in scope:** changing the weather provider, adding forecast horizons, or wiring weather into the energy reporting (that is POOLSE-28).

### BA — rules and data

- Minimum icon set: clear, partly cloudy, cloudy, rain, heavy rain, thunderstorm, snow, fog, wind (AC1).
- Day and night variants only where the provider distinguishes them; where it does not, one variant is used for both and the mapping must not invent a night state (AC2).
- Every icon carries a text label or `aria-label` — colour and shape never carry the meaning alone (AC4), consistent with the global colour rule.
- The provider's condition codes map to the Poolse icon set through one explicit mapping table; an unmapped or unknown code renders a defined fallback icon plus its raw label rather than a blank space.
- Icons must remain legible on light and dark backgrounds (AC3) — a set that only works on white is not acceptable.
- Licence: the chosen set must be licensed for commercial use and the licence recorded in the repo (AC5). This is a ship blocker, not a follow-up.
- Labels are i18n keys in pt-PT and en — "Trovoada" / "Thunderstorm" — never the provider's English strings passed through.
- Edge case: the provider returns a condition with no temperature, or is unreachable. The block must degrade to a stated "sem dados" state rather than to a sun icon.

### Dev — implementation notes

- No schema change. This is a presentation mapping plus assets.
- Ship the icons as inline SVG components with `currentColor` where the design allows, and explicit fills where the set is deliberately multicoloured; avoid a sprite fetched at runtime.
- Keep the provider-code → icon mapping in one module with a total mapping and an explicit default, so a new provider code degrades predictably instead of throwing.
- The icon component takes a condition code and renders icon plus accessible label together; there is no way to render the icon without its label, which is how AC4 is enforced structurally rather than by review.
- Theming: multicoloured icons need a checked contrast pass against both surface tokens; where a colour disappears on one background, add a stroke or adjust the token rather than swapping icon sets per theme.
- i18n: condition names live in the message catalogues; the mapping module returns keys, not strings.
- Performance: the set is small and static — inline it, and do not pull a full icon library for nine conditions.
- Most likely to get wrong: shipping a set whose licence forbids commercial use, or one whose yellows and light greys vanish on the dark surface. Record the licence in the repo at the same commit as the assets.

### QA — test scenarios

12.1 Given an installation whose current condition is "rain" / When the details page loads / Then the rain icon renders in colour with its text label.
12.2 Given each of the nine required conditions in turn / When rendered / Then each has a visually distinct icon — no two conditions share one.
12.3 Given a night-time timestamp and a provider that distinguishes day/night / When the block renders / Then the night variant is used; given a provider that does not, the single variant renders without error.
12.4 Given dark mode / When every icon in the set is rendered / Then each is legible against the dark surface and passes contrast; repeat in light mode.
12.5 Given a screen reader / When focus reaches the weather block / Then the condition is announced as text, not as an image name.
12.6 Given locale pt-PT / When the condition is thunderstorm / Then the label reads "Trovoada"; in en it reads "Thunderstorm".
12.7 Given the provider returns a condition code not present in the mapping / When the block renders / Then the fallback icon and the raw condition text are shown, and nothing throws.
12.8 Given the weather provider is unreachable / When the page loads / Then the block shows a no-data state and the rest of the installation page renders normally.
12.9 Given the page is rendered in greyscale (simulating colour blindness) / When conditions are compared / Then each is still identifiable from its shape and label.
12.10 Given the repo / When the icon assets are reviewed / Then a licence file or note covering commercial use accompanies them.

### Acceptance criteria

1. Distinct coloured icons for at least: clear, partly cloudy, cloudy, rain, heavy rain, thunderstorm, snow, fog, wind.
2. Day and night variants where the provider distinguishes them.
3. Icons remain legible on both light and dark backgrounds.
4. Each icon carries a text label/`aria-label` — colour alone never carries the meaning.
5. Icon set is licensed for commercial use; note the licence in the repo.
