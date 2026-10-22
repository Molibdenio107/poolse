# POOLSE-95 · The text cursor disappears (or turns white) over inputs

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Global / Forms · **Priority:** High (it affects every form) · **Depends on** —

### PO — why this exists

Rui, 22-10-2026, first seen on the Incidentes form: *"in the text inputs here, and not only here, the text mouse cursor disappears (or turns white). This happens a lot throughout the whole app."*

If you can't see where you're pointing or typing, every form in the app is harder to use.

### BA — what it is (confirmed by Rui, 22-10-2026)

- **Light mode only.** Dark mode is fine.
- **The mouse I-beam** (the pointer shape over a text field), **not** the blinking typing caret.

Windows draws its default I-beam *inverted* (XOR) against the pixels under it. Over pure white it shows black. Over light-grey or tinted light surfaces (our `--surface-muted`, `--input` `217 224 229` borders, focus rings, primary-tinted backgrounds), the inversion comes out pale or white and the pointer seems to vanish. Nothing in our CSS sets `cursor` on inputs, so the OS default is used everywhere.

**Fix:** ship our own I-beam with an outline, so it doesn't depend on what is under it:

```css
input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]),
textarea, [contenteditable='true'] {
  cursor: url('/cursors/ibeam.svg') 8 12, text;
}
```

The caret (`caret-color`) is left alone, since Rui confirmed it's fine.

### Dev notes

- One rule in the `globals.css` base layer, next to the existing input rules (≈ l.400–450). No per-component fixes.
- `apps/web/public/cursors/ibeam.svg`: 16×24, dark I-beam (`#1a1f24`) with a 1 px white outline, so it reads on light and dark. Always keep `text` as the fallback keyword. Check the hotspot (8 12) lands on the I-beam's centre.
- A note in `decisions.md`: why the app overrides the OS pointer on fields.

### QA — scenarios

1. Windows / Chrome and Edge, **light theme**: hover over every field on the Incidentes form (text, textarea, date, search, select-like comboboxes). The pointer stays visible over the field, its border, a focused field and a field with an error.
2. Same on: new student form, Preços, the search box, a dialog form.
3. Dark theme: no regression.
4. macOS / Safari: the pointer looks like a normal I-beam.

### Acceptance criteria

1. The I-beam pointer is visible over every text field in light mode, on Windows Chrome and Edge.
2. The fix lives in one place in `globals.css`, plus the SVG.

### Open questions

- None.
