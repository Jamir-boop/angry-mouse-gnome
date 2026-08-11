# Angry Mouse GNOME Port Plan

## Goal and constraints

Port the useful desktop behavior from `/home/superuser/Documents/rattlepop` to
a GNOME Shell 48 extension for Debian 13 under the identity **Angry Mouse**,
UUID `angry-mouse@rattlepop.click`, and schema
`org.gnome.shell.extensions.angry-mouse`. Preserve applicable defaults and
tuning ranges while removing every trial, payment, license validation, update,
telemetry, and network path. Publish the result under MIT.

The port uses the active GNOME cursor rather than shipping cursor collections.
It targets both X11 and Wayland and never changes GNOME's locate-pointer setting.

## Phase 1 — Platform mapping

- Replace Windows mouse hooks with GNOME Shell's idle-aware pointer watcher.
- Replace WPF overlays with a non-reactive Clutter actor in `Main.uiGroup`.
- Read the current cursor sprite, hotspot, scale, and visibility from Mutter's
  cursor tracker so text, resize, link, and theme cursors remain accurate.
- Replace registry/application settings with a relocatable-free GSettings
  schema installed with the extension.
- Replace the tray/settings application with GNOME's extension preferences.

Exit criterion: every retained feature has a supported GNOME API and no
Windows-only runtime dependency remains.

## Phase 2 — Behavior engine

- Retain samples from the configured tracking interval, sampled at most every
  10 ms. Require at least ten samples.
- Compute average segment speed and count sharp reversals using a negative dot
  product, matching the source detector.
- Implement shared hold/toggle state for mouse and keyboard activation.
- Implement shortcut matching and same-side double-Control recognition using
  GNOME's native double-click interval, bounce rejection, and a 10 ms hold grace.
- Keep at least one activation source effective if stored settings are damaged.

Exit criterion: pure GJS tests cover sample limits, speed, turns, pruning,
double-Control timing, side matching, and hold behavior.

## Phase 3 — Shell integration

- Render the active cursor at the live pointer hotspot and scale it to
  `254 × cursor-size / 10` logical pixels high.
- Animate show/hide with cubic ease-in-out and the configured duration.
- Follow the pointer continuously while visible and refresh on cursor changes.
- Hide the native cursor only after a valid replacement sprite exists; restore
  its previous visibility on deactivation, errors, setting changes, and disable.
- Observe keyboard events without consuming them and disconnect every watcher,
  signal, timeout, and actor during disable.

Exit criterion: shake, shortcuts, cursor-shape changes, hold/toggle mode, and
enable/disable are safe in an isolated GNOME Shell session.

## Phase 4 — Preferences and compatibility

- Provide native Cursor and Triggers pages using GTK 4/libadwaita.
- Preserve these defaults: size 8, animation 150 ms, visibility 1000 ms,
  shake enabled, keyboard enabled, hold mode, Control-only shortcut, 200 ms
  tracking, 0.5 minimum speed, two turns, and visible system cursor.
- Preserve source ranges: size 2–10; animation 50–1000 ms; visibility
  100–3000 ms; tracking 100–2000 ms; speed 0.2–5.0; turns 1–12.
- Record only supported modifier combinations plus A–Z, 0–9, F1–F12, Space,
  Escape, or no main key. Enforce at least one activation source in the UI.

Exit criterion: settings update live, survive a Shell restart, and remain valid
under the schema ranges.

## Phase 5 — Verification and release

- Run the pure engine check, ESLint, and strict schema validation.
- Build with `gnome-extensions pack` and inspect the ZIP contents.
- Install and smoke-test locally without leaving test Shell processes running.
- Create screenshots and listing copy, then upload the source ZIP to
  <https://extensions.gnome.org/upload/> for automated and human review.
- After acceptance, tag releases from
  `https://github.com/Jamir-boop/angry-mouse-gnome` and submit compatible Shell
  versions only after testing them.

Exit criterion: the distributable is reproducible, license-clean, free of
commercial/network code, and accepted by extensions.gnome.org.

## Explicit exclusions

Cursor collections and role editing, import/export, Windows tray/startup,
Windows themes, updater, debug tooling, telemetry, payments, trials, account
state, and license enforcement are excluded. Add them only if a future GNOME
use case cannot be met by the current system cursor and passes extension review.
