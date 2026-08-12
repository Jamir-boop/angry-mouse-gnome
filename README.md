<p align="center">
  <img src="assets/hero.svg" alt="Angry Mouse — never lose your pointer" width="100%">
</p>

<p align="center">
  <a href="https://extensions.gnome.org/extension/10680/angry-mouse/"><img alt="Install from GNOME Extensions" src="https://img.shields.io/badge/Install-GNOME_Extensions-4a86cf?style=for-the-badge&logo=gnome&logoColor=white"></a>
  <img alt="GNOME Shell 48" src="https://img.shields.io/badge/GNOME_Shell-48-4a86cf?style=for-the-badge&logo=gnome&logoColor=white">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge"></a>
</p>

**Angry Mouse** makes the active pointer large and animated after a mouse shake
or keyboard activation. Its fading laser trail highlights anything on screen
while the click-drag still reaches the application below.

It uses the current system cursor, so theme changes and application-specific
cursor shapes keep working.

## Features

- **Find it fast:** shake the mouse, press a shortcut, or double-press Control
- **Present clearly:** hold `Ctrl+Alt` and left-drag to draw a fading laser trail
- **Make it yours:** configure shortcuts and choose hold or toggle activation
- **Keep native behavior:** input passes through and the current cursor theme remains intact
- Optional hiding of the normal system cursor while active
- Native GNOME preferences
- Wayland and X11 support through GNOME Shell APIs

## Install

[Install Angry Mouse from GNOME Extensions](https://extensions.gnome.org/extension/10680/angry-mouse/),
then open its settings from the Extensions app.

> Angry Mouse currently supports GNOME Shell 48.

## How the laser works

1. Hold `Ctrl+Alt`.
2. Left-click and drag.
3. Release to stop; the trail fades automatically.

The shortcut and hold/toggle behavior are configurable in preferences.

## Scope

This GNOME port intentionally excludes the Windows cursor collections, role
editor, import/export, tray, startup, updater, telemetry, payments, trials, and
license checks.

## Development

### Test and package

```sh
gjs -m tests/engine.test.js
glib-compile-schemas --strict --dry-run schemas
eslint engine.js extension.js prefs.js tests/engine.test.js
mkdir -p dist
gnome-extensions pack --force \
  --schema=schemas/org.gnome.shell.extensions.angry-mouse.gschema.xml \
  --extra-source=engine.js --extra-source=LICENSE --out-dir=dist .
```

Install the generated ZIP for the current user:

```sh
gnome-extensions install --force dist/angry-mouse@rattlepop.click.shell-extension.zip
```

Follow focused runtime diagnostics in the GNOME journal:

```sh
journalctl --user -f -o cat | grep --line-buffered '\[Angry Mouse\]'
```

Log out and back in after the first installation, then enable and configure it:

```sh
gnome-extensions enable angry-mouse@rattlepop.click
gnome-extensions prefs angry-mouse@rattlepop.click
```

### Publishing

Upload the generated ZIP at <https://extensions.gnome.org/upload/>. The archive
contains source code, metadata, the schema source, and the MIT license; it does
not contain a compiled schema, binary dependency, or commercial licensing code.

## License

MIT. See [LICENSE](LICENSE).
