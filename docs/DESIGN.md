# Dashboard design: fluid interface spec

**Context**
- Product / screen: personal money dashboard, opened from LINE (LIFF), full page
- Platform: iOS-inspired web, phone first (LINE in-app browser), works on desktop
- Interaction focus: full page + one drag sheet (details) + period swipe + segmented control
- Stack: Next.js + React 19 + Motion (`motion/react`), Lucide icons
- What existed: static cards, CSS hover only, emoji labels, light/dark by OS, no details view
- Goal: feel direct, interruptible and physical; make logging progress visible and fun

## A. Feel audit (before)

| Quality | Score | Evidence |
|---|---|---|
| Response | 2 | Buttons only react on click (`onClick`); no pressed state on pointer-down |
| Directness | 1 | Nothing can be dragged; changing period is ‹ › buttons only |
| Interruptibility | 2 | No animation to interrupt, but data swaps jump with no continuity |
| Spring behavior | 1 | No motion at all; numbers and bars snap to new values |
| Spatial consistency | 2 | Next/previous period replaces content in place, no direction cue |
| Materials | 2 | All surfaces solid cards; no persistent toolbar; no depth for focus |
| Reduced motion | 3 | Nothing to reduce, so trivially safe; no explicit handling |

## B. Interaction redesign

### Primary: details sheet (tap a heat-map day, a bar, or a category)

**Happy path**
1. Pointer-down on the target: it scales to 0.96 in the same frame (press highlight).
2. Release without moving more than 10px: the sheet materializes from the bottom edge (y from 100% to the half-snap at 45% of the viewport). The scrim fades to 40% black in step with the sheet's progress, driven by the same motion value.
3. The sheet shows a summary (amount, entries, mini list) for what was tapped.
4. The user drags the grabber/header: 1:1 tracking, grab offset kept (Motion drag, pointer capture). Past 10px of vertical travel the drag takes over and the list stops scrolling.
5. Release: the projected rest position is `y + v × 0.499` (iOS normal deceleration 0.998: `v/1000 × 0.998/(1−0.998)`). Snap to the nearest of {full (8%), half (45%), closed (100%)} from the projection, not from the release point.
6. Spring to the snap with the finger's velocity handed off (`velocity: v`).

**Interrupt / reverse**
- Grabbing the sheet mid-spring stops the spring at its current presentation value (Motion drag starts from the live `y`); no input lock at any time.
- Tapping the scrim during the opening spring closes it from wherever it is, on the same vertical path.
- Opening another target while one is open swaps content in place (crossfade); the sheet doesn't close and reopen.

**Edges / rubber-band**
- Above the full snap: `dragElastic` 0.12 on top (resistance grows with distance), springs back on release.
- Below closed: free; projection past 70% of the viewport dismisses.

**Reduced motion**
- `MotionConfig reducedMotion="user"` turns transform animations into instant jumps. The sheet appears at half without sliding; the scrim still crossfades (opacity is allowed). Dragging still works (direct manipulation isn't decorative motion).

### Secondary: period swipe (the header band)
- Horizontal drag on the period label, 1:1 with `dragElastic` 0.2. Projection `x + vx × 0.2` beyond ±80px changes the period; otherwise it springs back.
- Swiping toward the future when that period hasn't started: stronger rubber band (elastic 0.08) and always springs back.
- The new label enters from the side the finger moved toward and the old one exits the opposite way (same path, mirrored).
- Arrow buttons trigger the same transition and direction.
- Reduced motion: crossfade only.

### Segmented control (Day … Year)
- The selected pill is a shared-layout element (`layoutId`) that springs to the new segment; interrupted by another tap, it re-targets from where it is.
- Press: the segment's label dims on pointer-down.

## C. Motion spec

| Element | Properties | Spring | Bounce allowed |
|---|---|---|---|
| Sheet snap | `y` (transform) | response 0.3s, damping 0.8 → `{ type: "spring", visualDuration: 0.3, bounce: 0.2 }` when release `|v| > 600px/s`, else `bounce: 0` | Only with momentum |
| Scrim | `opacity` derived from sheet `y` (`useTransform`) | none (follows the sheet) | n/a |
| Period label | `x`, `opacity` | move: `{ visualDuration: 0.4, bounce: 0 }` (damping 1.0) | No |
| Segment pill | layout (`transform`) | `{ visualDuration: 0.35, bounce: 0 }` | No |
| Press feedback | `scale` 0.96 | `{ visualDuration: 0.15, bounce: 0 }` | No |
| Numbers | displayed value via `useSpring` | `{ visualDuration: 0.6, bounce: 0 }` | No |
| Bars / heat cells on data change | `scaleY` / `opacity` | `{ visualDuration: 0.4, bounce: 0 }` staggered 8ms | No |

**Velocity handoff:** `onDragEnd(_, info)` reads `info.velocity.y` / `.x` in px/s and passes it as `velocity` to `animate(mv, target, spring)`.

**Must not use CSS keyframes/transitions:** sheet position, scrim tied to the sheet, period swipe, segment pill, anything a finger can grab. CSS transitions are OK only for hover tints and theme color changes.

## D. Materials & hierarchy

| Surface | Material |
|---|---|
| Top bar (title, segmented control, period) | Translucent, sticky: surface at 72% + `backdrop-filter: saturate(180%) blur(20px)`. Hairline bottom border only once content scrolls under it |
| Cards | Solid surface-1, 1px hairline ring, 16px radius, no shadow (flat in dark mode) |
| Details sheet | Thick material: surface at 88% + `blur(28px) saturate(160%)`, top radius 20px, shadow `0 -8px 40px rgba(0,0,0,.35)` |
| Scrim | Yes, behind the sheet only: black at 0 → 40% opacity, tied to the sheet's progress |
| Tooltip | Solid surface-1, small shadow `0 4px 16px rgba(0,0,0,.25)` |

There's no glass on glass: the sheet sits over the dimmed scrim, never over the translucent top bar (the top bar sits under the scrim).

Shadow weight scales with size: tooltip (16px blur) < sheet (40px). Cards have none.

## E. Implementation checklist
- [x] Wrap the page in `<MotionConfig reducedMotion="user">`.
- [x] Use `motion.button` with `whileTap={{ scale: 0.96 }}` (fires on pointer-down) for every control.
- [x] Sheet: `motion.div` with `drag="y"`, `dragListener={false}`, `useDragControls()`; start the drag from the header `onPointerDown` after 10px of movement; `dragMomentum={false}`; snap from `onDragEnd` with projection; `y` is a `useMotionValue`; scrim opacity `useTransform(y, [full, closed], [0.4, 0])`.
- [x] `touch-action: none` on the sheet header, `pan-y` on the list, `overscroll-behavior: contain` on the list.
- [x] Period swipe: `drag="x"`, `dragSnapToOrigin`, decide from `info.offset.x + info.velocity.x × 0.2`, `AnimatePresence custom={direction}` with `mode="popLayout"`.
- [x] Segmented control: `motion.span layoutId="seg-pill"` inside the active button.
- [x] Animated numbers: `useSpring` + `useTransform` to a formatted string; skip the spring under reduced motion.
- [x] Dark by default: tokens on `.dash` are dark; `[data-theme="light"]` overrides; the toggle persists in `localStorage` with try/catch; an inline script sets the theme before paint.
- [x] Lucide icons with `aria-hidden` and a text label beside them; no emoji in the UI.
- [ ] Haptics: the Vibration API isn't available in iOS WebViews, so none are added. [NEEDS INPUT] if Android-only haptics are wanted.

## F. Do / Don't for this screen

**Do**
1. Open details from the exact thing tapped (day cell, bar, category): the sheet's title names it.
2. Let the user drag the sheet away from any snap mid-animation.
3. Keep the period swipe on the header band only, so it never fights vertical scroll in the charts.
4. Animate numbers from their previous value when the period changes, so the change is legible.
5. Show the logging streak and heat map near the top: it's the habit this whole app exists for.

**Don't**
1. Don't block taps while the sheet or period label is animating.
2. Don't bounce the segmented pill or the numbers: bounce only where a finger threw something.
3. Don't put the sheet's translucent material over the translucent top bar without the scrim between them.
4. Don't use color alone for heat-map meaning: no-spend days get a check mark and missed days an outline, with the legend spelling both out.
5. Don't animate chart widths or `left`: grow bars with `scaleY` from the baseline only.
