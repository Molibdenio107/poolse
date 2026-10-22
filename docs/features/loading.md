# Something is happening — the corner indicator

POOLSE-98 (Rui, 22-10-2026). When anything the app started is slow, a small pill in the
bottom-right corner says so: *A carregar…*, *A guardar…* or *A exportar…*. There is no top
progress bar (Rui: the corner only).

## When it shows

- **Only past 400 ms**, so a fast save or a quick tab never flickers, and **at least 300 ms**
  once shown, so it does not blink. Both are `BusyIndicator`'s rule (`components/busy-indicator.tsx`).
- **What counts:** every page a link opens (`FromLink` and the plain links that carry `LinkBusy`:
  *Voltar*, the menu, app mode), a tab rendered on the server (`DetailTabs`), every form that
  saves (`useSavedAction`, so no form needs a line of its own), and every export or certificate
  download (`DownloadLink`).
- **Several things at once count as several** (`lib/busy.ts`: `beginBusy` returns an id, `endBusy`
  names it). The label is the most recent thing still running.

## Where it sits

- Fixed bottom right, above the safe area, taking no clicks. Toasts are top centre and above it
  in the stacking order, so the two never cover each other.
- A bar stuck to the bottom of the screen carries `data-bottom-bar` (the register's Save bar), and
  the corner lifts itself above it.
- A polite live region, always mounted, says the label once to a screen reader. Under reduced
  motion the turning ring is a pulsing dot.

## Exports

`DownloadLink` keeps a real `href`, so a modified click or no JavaScript still gets the file the
old way. A plain click fetches the file under *A exportar…*, saves it under the server's own
name, and says a failure in a toast instead of leaving the page for an error. A PDF that opens
its own tab (`target="_blank"`) is left to the browser.

## Slow things, written down

In development, anything over 1.5 s is logged to the console as `[poolse:slow] <kind> took
<ms> ms on <route>`: the list of candidates to make faster. Nothing is sent anywhere.
