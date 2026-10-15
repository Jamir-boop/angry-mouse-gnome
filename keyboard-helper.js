#!/usr/bin/gjs -m
import GLib from 'gi://GLib';
import System from 'system';

async function watchKeyboard() {
    if (!GLib.getenv('DISPLAY'))
        throw new Error('An X11 display is required');
    const {default: Atspi} = await import('gi://Atspi');
    Atspi.init();
    const device = Atspi.DeviceX11.new();
    device.add_key_watcher((_device, pressed, keycode, keysym, _modifiers, _text) => {
        print(JSON.stringify([keycode, keysym, pressed, GLib.get_monotonic_time() / 1000]));
    });
    print('ready');
    new GLib.MainLoop(null, false).run();
}

watchKeyboard().catch(() => {
    console.error('Keyboard observer failed to start');
    System.exit(1);
});
