# Angry Mouse

Angry Mouse is a GNOME Shell 48 extension for Debian that makes the active
pointer large and animated after a mouse shake or keyboard activation. It uses
the current system cursor, so cursor theme changes and application-specific
cursor shapes continue to work.

## Features

- Fast back-and-forth mouse shake detection
- Hold or toggle activation
- Configurable shortcut or double-Control activation
- Pass-through laser pointer with configurable hold/toggle modifier shortcut
- Optional hiding of the normal system cursor while active
- Native GNOME preferences with the original applicable defaults and ranges
- X11 and Wayland support through GNOME Shell APIs

The Windows cursor collections, role editor, import/export, tray, startup,
updater, telemetry, payments, trials, and license checks are intentionally not
part of this GNOME port.

## Test and package

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

## Publishing

Upload the generated ZIP at <https://extensions.gnome.org/upload/>. The archive
contains source code, metadata, the schema source, and the MIT license; it does
not contain a compiled schema, binary dependency, or commercial licensing code.

## License

MIT. See [LICENSE](LICENSE).
