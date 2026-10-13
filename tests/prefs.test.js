/* global TextDecoder */
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

class Widget {
    constructor(properties = {}) {
        this.handlers = new Map();
        this.children = [];
        this.suffixes = [];
        this.controllers = [];
        for (const property of ['active', 'selected', 'value']) {
            let value = 0;
            Object.defineProperty(this, property, {
                get: () => value,
                set: next => {
                    if (value === next)
                        return;
                    value = next;
                    this.emit(`notify::${property}`);
                },
            });
        }
        Object.assign(this, properties);
    }

    connect(signal, callback) {
        if (!this.handlers.has(signal))
            this.handlers.set(signal, []);
        this.handlers.get(signal).push(callback);
    }

    emit(signal) {
        for (const callback of this.handlers.get(signal) || [])
            callback(this);
    }

    add(child) { this.children.push(child); }
    add_suffix(child) { this.suffixes.push(child); }
    add_controller(controller) { this.controllers.push(controller); }
    set_default_size() {}
}

class Settings {
    constructor() {
        this.values = {
            'shake-enabled': true,
            'keyboard-enabled': false,
            'activation-mode': 1,
            'activation-method': 0,
            'hotkey-modifiers': 'Control',
            'hotkey-key': 'None',
            'laser-enabled': true,
            'laser-activation-mode': 0,
            'laser-hotkey-modifiers': 'Control+Alt',
            'laser-hotkey-key': 'None',
        };
        this.handlers = new Map();
        this.nextId = 0;
        this.writes = [];
    }

    get_enum(key) { return this.values[key]; }
    get_string(key) { return this.values[key]; }

    connect(signal, callback) {
        const id = ++this.nextId;
        this.handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) { this.handlers.delete(id); }

    set_enum(key, value) { this.set_string(key, value); }

    set_string(key, value) {
        if (this.values[key] === value)
            return;
        this.values[key] = value;
        this.writes.push([key, value]);
        for (const {signal, callback} of this.handlers.values()) {
            if (signal === `changed::${key}`)
                callback(this, key);
        }
    }

    bind(key, widget, property) {
        widget[property] = this.values[key] ?? 0;
        widget.connect(`notify::${property}`, () => this.set_string(key, widget[property]));
        this.connect(`changed::${key}`, () => { widget[property] = this.values[key]; });
    }
}

const [, bytes] = GLib.file_get_contents(
    `${GLib.path_get_dirname(System.programPath)}/../prefs.js`);
const source = new TextDecoder().decode(bytes);
const Preferences = new Function(
    'ExtensionPreferences', 'Adw', 'Gdk', 'Gio', 'Gtk',
    source.slice(source.indexOf('export default class')).replace('export default ', 'return ')
)(
    class {},
    {
        PreferencesPage: Widget, PreferencesGroup: Widget, SpinRow: Widget,
        SwitchRow: Widget, ComboRow: Widget, ActionRow: Widget,
    },
    Gdk,
    Gio,
    {
        Align: Gtk.Align, PropagationPhase: Gtk.PropagationPhase,
        EventControllerKey: Gtk.EventControllerKey, Adjustment: Widget,
        Button: Widget, ShortcutLabel: Widget, StringList: {new: choices => choices},
    }
);

function fixture() {
    const settings = new Settings();
    const preferences = Object.assign(new Preferences(), {getSettings: () => settings});
    const window = new Widget();
    preferences.fillPreferencesWindow(window);
    const groups = window.children[1].children;
    return {
        preferences, settings, window,
        shake: groups[0].children[0],
        keyboard: groups[1].children[0],
        mode: groups[1].children[1],
        method: groups[1].children[2],
        requireSuper: groups[1].children[3],
        cursor: groups[1].children[4],
        laser: groups[2].children[2],
    };
}

function press(controller, key, state = 0) {
    return controller.emit('key-pressed', key, 0, state);
}

function release(controller, key) {
    controller.emit('key-released', key, 0, 0);
}

let failures = 0;
function test(name, callback) {
    try {
        callback();
    } catch (error) {
        failures++;
        print(`${name}: ${error.message}`);
    }
}

test('empty modifier release', () => {
    const {settings, window, cursor} = fixture();
    cursor.suffixes[1].emit('clicked');
    release(window.controllers[0], Gdk.KEY_Control_L);
    assert(settings.values['hotkey-modifiers'] === 'Control' && settings.writes.length === 0,
        'a modifier held before recording does not clear the saved shortcut on release');
    assert(cursor.suffixes[1].label === 'Press keys…', 'an unrecorded release keeps recording open');
    press(window.controllers[0], Gdk.KEY_Control_L);
    release(window.controllers[0], Gdk.KEY_Control_L);
    assert(cursor.suffixes[1].label === 'Record', 'a recorded modifier-only shortcut ends recording');
});

test('empty save validation', () => {
    const {preferences, settings} = fixture();
    for (const prefix of ['hotkey', 'laser-hotkey']) {
        preferences._saveShortcut(new Set(), 'None', {
            modifiersKey: `${prefix}-modifiers`, keyKey: `${prefix}-key`,
        });
    }
    assert(settings.writes.length === 0, 'neither shortcut accepts an empty modifier and key pair');
});

test('Space recording', () => {
    const {settings, window, cursor} = fixture();
    assert(window.controllers.every(controller =>
        controller.get_propagation_phase() === Gtk.PropagationPhase.CAPTURE),
    'recorders receive keys before the focused button handles Space');
    cursor.suffixes[1].emit('clicked');
    assert(press(window.controllers[0], Gdk.KEY_space), 'recording consumes Space');
    assert(settings.values['hotkey-key'] === 'Space' && settings.values['hotkey-modifiers'] === 'None',
        'Space without a modifier remains a supported shortcut');
    assert(cursor.suffixes[1].label === 'Record', 'Space ends recording');
});

test('shared activation mode', () => {
    const {settings, shake, keyboard, mode, method, requireSuper, cursor} = fixture();
    assert(mode.sensitive, 'shake-only activation can change Hold or Toggle mode');
    assert(mode.title === 'Cursor activation mode' && mode.subtitle.includes('mouse shake'),
        'the shared control states that it applies to mouse shake');
    mode.selected = 0;
    assert(settings.values['activation-mode'] === 0, 'the mode control saves Hold mode');
    settings.set_enum('activation-mode', 1);
    assert(mode.selected === 1, 'the mode control follows stored setting changes');
    keyboard.active = true;
    settings.set_enum('activation-method', 3);
    assert(requireSuper.visible && !cursor.visible && method.sensitive,
        'double Control settings follow changes from another settings client');
    shake.active = false;
    keyboard.active = false;
    assert(shake.active && settings.values['shake-enabled'], 'at least one cursor source stays enabled');
    assert(mode.sensitive && !method.sensitive, 'shared mode stays available after keyboard disable');
});

test('accelerator labels', () => {
    const {preferences} = fixture();
    assert(preferences._accelerator('Control', 'D') === '<Control>d', 'letter D remains visible');
    assert(preferences._accelerator('Control', 'D1') === '<Control>1', 'encoded digits lose only their prefix');
    assert(preferences._accelerator('Control+Alt', 'None') === '<Control><Alt>',
        'modifier-only labels remain unchanged');
});

test('supported keys and held modifiers', () => {
    const {settings, window, cursor} = fixture();
    for (const [key, name] of [
        [Gdk.KEY_a, 'A'], [Gdk.KEY_D, 'D'], [Gdk.KEY_0, 'D0'],
        [Gdk.KEY_F12, 'F12'], [Gdk.KEY_space, 'Space'], [Gdk.KEY_Escape, 'Escape'],
    ]) {
        cursor.suffixes[1].emit('clicked');
        press(window.controllers[0], key, Gdk.ModifierType.CONTROL_MASK);
        assert(settings.values['hotkey-key'] === name && settings.values['hotkey-modifiers'] === 'Control',
            `${name} records with a modifier already held`);
    }
    cursor.suffixes[1].emit('clicked');
    const before = settings.writes.length;
    press(window.controllers[0], Gdk.KEY_a, Gdk.ModifierType.SUPER_MASK);
    assert(cursor.suffixes[1].label === 'Unsupported' && settings.writes.length === before,
        'Super combinations remain unsupported');
    cursor.suffixes[2].emit('clicked');
    assert(settings.values['hotkey-key'] === 'None' && settings.values['hotkey-modifiers'] === 'Control',
        'Reset stops recording and restores the cursor default');
});

test('laser recording and recorder cleanup', () => {
    const {preferences, settings, window, cursor, laser, mode} = fixture();
    cursor.suffixes[1].emit('clicked');
    laser.suffixes[1].emit('clicked');
    assert(cursor.suffixes[1].label === 'Record', 'starting another recorder stops the first');
    assert(!press(window.controllers[0], Gdk.KEY_a), 'an inactive recorder does not consume keys');
    press(window.controllers[1], Gdk.KEY_a);
    assert(laser.suffixes[1].label === 'Unsupported' && settings.writes.length === 0,
        'laser shortcuts still require modifiers only');
    release(window.controllers[1], Gdk.KEY_Control_L);
    assert(settings.writes.length === 0, 'an unrecorded laser modifier release cannot clear its shortcut');
    press(window.controllers[1], Gdk.KEY_Shift_L);
    press(window.controllers[1], Gdk.KEY_Control_L);
    release(window.controllers[1], Gdk.KEY_Control_L);
    assert(settings.values['laser-hotkey-modifiers'] === 'Control+Shift' &&
        settings.values['laser-hotkey-key'] === 'None', 'laser modifiers keep their canonical order');
    assert(laser.suffixes[0].accelerator === '<Control><Shift>', 'shortcut labels follow stored changes');
    laser.suffixes[2].emit('clicked');
    assert(settings.values['laser-hotkey-modifiers'] === 'Control+Alt', 'Reset restores the laser default');
    laser.suffixes[1].emit('clicked');
    const signalIds = [...preferences._settingsSignalIds];
    window.emit('close-request');
    assert(laser.suffixes[1].label === 'Record' && preferences._settings === null,
        'closing preferences stops the active recorder and clears its settings');
    assert(signalIds.every(id => !settings.handlers.has(id)), 'closing disconnects tracked settings signals');
    settings.set_enum('activation-mode', 0);
    assert(mode.selected === 1, 'closed preferences do not receive later setting changes');
    assert(!press(window.controllers[1], Gdk.KEY_a), 'closed recorders do not consume keys');
});

assert(failures === 0, `${failures} preference test groups failed`);
print('preference tests passed');
