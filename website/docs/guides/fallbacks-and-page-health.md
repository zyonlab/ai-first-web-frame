# Fallbacks and page health

Partial degradation is a designed feature. The question this guide answers is: *when does
degradation change the HTTP status code?*

## Three levels

| Level | What it is |
| --- | --- |
| Slot fallback | one slot renders its declared `manifest.fallback` HTML |
| `degraded` | at least one **optional** slot fell back — page still answers `200` |
| `unhealthy` | at least one **required** slot fell back — gateway answers `503` |

`required: true` on a slot is what promotes a failure from cosmetic to fatal. This is Tailor's
`primary` semantic: a page whose main content is dead should not answer `200`, because crawlers
will index the degraded markup as real content and success-rate monitoring will see nothing
wrong.

## How the status actually gets set

A Next.js App Router `page.tsx` cannot set a response status or header — only middleware and
route handlers can. But the shell gateway already reads the upstream body as text. So the page
**stamps its health into the markup** and the gateway translates it:

```tsx
import { PageHealthMeta } from "@mvp/runtime/react";

<PageHealthMeta health={execution.health} failed={failedRequiredSlotNames(execution)} />
```

which emits

```html
<div hidden data-mvp-page-health="unhealthy" data-failed-slots="book,orderForm"></div>
```

(`PAGE_HEALTH_ATTR` and `PAGE_HEALTH_FAILED_ATTR` in `@mvp/runtime` — note the second is
`data-failed-slots`, not a `data-mvp-` prefixed name.)

The gateway calls `readPageHealthFromHtml`, and on `unhealthy` answers `503` with `retry-after`
**while returning the body unchanged** — so a human still sees the degraded page and a monitor
still sees a failure. `degraded` stays `200`.

`SHELL_REQUIRED_FAILURE_STATUS=0` disables the translation and keeps the upstream status.

### Why a hidden `div` and not a `<meta>`

Because it is an internal signal for the gateway, not metadata about the document. React 19
*would* hoist a `<meta>` rendered from a page component into `<head>` — verified by SSR probe —
and `<head>` is the document's public metadata surface, read by crawlers and third-party tools.
A degradation signal does not belong there.

(Under React 18 the same `<meta>` stayed in `<body>`, which is invalid HTML. The repository is on
React 19 now, so the constraint is gone and the choice is deliberate rather than forced.)

## Streaming pages

Use `PageHealthMetaStream`, which takes the aggregate promise and emits the marker once the
rollup is known. The marker necessarily appears late in the body — which is fine, because the
gateway buffers the page body to translate the status anyway.

## Designing a good fallback

- Keep the `data-fragment="<name>"` root and add `data-fallback="true"`. Runtime code keys on it:
  the live-panel driver refuses to mount a panel on a fallback node.
- Make it readable without JavaScript. The `no-js` Playwright project renders every page with
  JavaScript disabled and asserts the content is there.
- Do not reserve zero height. `maxCLS` is budgeted at `0`, and a fallback that collapses and then
  expands is a layout shift.
