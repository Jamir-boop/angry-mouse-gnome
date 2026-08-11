import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AngryMousePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._settingsSignalIds = [];
        window.set_default_size(640, 720);

        const cursorPage = new Adw.PreferencesPage({
            title: 'Cursor',
            icon_name: 'input-mouse-symbolic',
        });
        const cursorGroup = new Adw.PreferencesGroup({title: 'Appearance'});
        cursorGroup.add(this._spinRow('Size', 'cursor-size', 2, 10, 1, 0));
        cursorGroup.add(this._spinRow('Animation duration', 'animation-duration-ms', 50, 1000, 50, 0, ' ms'));
        cursorGroup.add(this._spinRow('Visible after shaking', 'visible-duration-ms', 100, 3000, 100, 0, ' ms'));
        cursorGroup.add(this._switchRow('Hide the system cursor', 'hide-system-cursor'));
        cursorPage.add(cursorGroup);
        window.add(cursorPage);

        const triggerPage = new Adw.PreferencesPage({
            title: 'Triggers',
            icon_name: 'preferences-system-symbolic',
        });
        const shakeGroup = new Adw.PreferencesGroup({title: 'Mouse shake'});
        const shakeSwitch = this._switchRow('Enable mouse shake', 'shake-enabled');
        const shakeWindow = this._spinRow('Tracking interval', 'shake-window-ms', 100, 2000, 50, 0, ' ms');
        const shakeSpeed = this._spinRow('Minimum speed', 'shake-minimum-speed', 0.2, 5, 0.1, 1);
        const shakeTurns = this._spinRow('Minimum turns', 'shake-minimum-turns', 1, 12, 1, 0);
        shakeGroup.add(shakeSwitch);
        shakeGroup.add(shakeWindow);
        shakeGroup.add(shakeSpeed);
        shakeGroup.add(shakeTurns);
        triggerPage.add(shakeGroup);

        const keyboardGroup = new Adw.PreferencesGroup({title: 'Keyboard'});
        const keyboardSwitch = this._switchRow('Enable keyboard activation', 'keyboard-enabled');
        const modeRow = this._comboRow('Mode', ['Hold', 'Toggle'], 'activation-mode');
        const methodRow = this._comboRow('Method', [
            'Shortcut',
            'Double Left Control',
            'Double Right Control',
            'Double Either Control',
        ], 'activation-method');
        const requireSuper = this._switchRow('Require Super', 'require-super');
        requireSuper.subtitle = 'Applies to double Control methods';
        const shortcutRow = this._shortcutRow(window);
        keyboardGroup.add(keyboardSwitch);
        keyboardGroup.add(modeRow);
        keyboardGroup.add(methodRow);
        keyboardGroup.add(requireSuper);
        keyboardGroup.add(shortcutRow);
        triggerPage.add(keyboardGroup);
        window.add(triggerPage);

        const sync = () => {
            if (!shakeSwitch.active && !keyboardSwitch.active)
                shakeSwitch.active = true;
            const keyboardEnabled = keyboardSwitch.active;
            modeRow.sensitive = keyboardEnabled;
            methodRow.sensitive = keyboardEnabled;
            shortcutRow.visible = keyboardEnabled && methodRow.selected === 0;
            requireSuper.visible = keyboardEnabled && methodRow.selected !== 0;
            shakeWindow.sensitive = shakeSwitch.active;
            shakeSpeed.sensitive = shakeSwitch.active;
            shakeTurns.sensitive = shakeSwitch.active;
        };
        shakeSwitch.connect('notify::active', sync);
        keyboardSwitch.connect('notify::active', sync);
        methodRow.connect('notify::selected', sync);
        sync();

        window.connect('close-request', () => {
            for (const id of this._settingsSignalIds)
                this._settings.disconnect(id);
            this._settingsSignalIds = null;
            this._shortcutLabel = null;
            this._recordingModifiers = null;
            this._settings = null;
            return false;
        });
    }

    _spinRow(title, key, lower, upper, step, digits, suffix = '') {
        const row = new Adw.SpinRow({
            title,
            digits,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step}),
        });
        if (suffix)
            row.subtitle = `Range: ${lower}–${upper}${suffix}`;
        this._settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _switchRow(title, key) {
        const row = new Adw.SwitchRow({title});
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _comboRow(title, choices, key) {
        const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices)});
        row.selected = this._settings.get_enum(key);
        row.connect('notify::selected', () => this._settings.set_enum(key, row.selected));
        this._settingsSignalIds.push(this._settings.connect(`changed::${key}`, () => {
            const selected = this._settings.get_enum(key);
            if (row.selected !== selected)
                row.selected = selected;
        }));
        return row;
    }

    _shortcutRow(window) {
        const row = new Adw.ActionRow({
            title: 'Shortcut',
            subtitle: 'A modifier-only shortcut is supported',
        });
        this._shortcutLabel = new Gtk.ShortcutLabel({valign: Gtk.Align.CENTER});
        const recordButton = new Gtk.Button({label: 'Record', valign: Gtk.Align.CENTER});
        const resetButton = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        row.add_suffix(this._shortcutLabel);
        row.add_suffix(recordButton);
        row.add_suffix(resetButton);
        row.activatable_widget = recordButton;

        const syncLabel = () => {
            const modifiers = this._settings.get_string('hotkey-modifiers');
            const key = this._settings.get_string('hotkey-key');
            this._shortcutLabel.accelerator = this._accelerator(modifiers, key);
        };
        this._settingsSignalIds.push(
            this._settings.connect('changed::hotkey-modifiers', syncLabel),
            this._settings.connect('changed::hotkey-key', syncLabel));
        syncLabel();

        const controller = new Gtk.EventControllerKey();
        window.add_controller(controller);
        recordButton.connect('clicked', () => {
            this._recording = !this._recording;
            this._recordingModifiers = new Set();
            recordButton.label = this._recording ? 'Press keys…' : 'Record';
        });
        resetButton.connect('clicked', () => {
            this._recording = false;
            recordButton.label = 'Record';
            this._settings.set_string('hotkey-modifiers', 'Control');
            this._settings.set_string('hotkey-key', 'None');
        });
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            if (!this._recording)
                return false;
            const modifier = this._modifierName(keyval);
            if (modifier) {
                this._recordingModifiers.add(modifier);
                return true;
            }
            const key = this._keyName(keyval);
            const modifiers = this._modifiersFromState(state);
            for (const item of this._recordingModifiers)
                modifiers.add(item);
            if (!key || state & Gdk.ModifierType.SUPER_MASK) {
                recordButton.label = 'Unsupported';
                return true;
            }
            this._saveShortcut(modifiers, key, recordButton);
            return true;
        });
        controller.connect('key-released', (_controller, keyval) => {
            if (!this._recording || !this._modifierName(keyval))
                return;
            this._saveShortcut(this._recordingModifiers, 'None', recordButton);
        });
        return row;
    }

    _saveShortcut(modifiers, key, button) {
        const ordered = ['Control', 'Alt', 'Shift'].filter(item => modifiers.has(item));
        this._settings.set_string('hotkey-modifiers', ordered.length ? ordered.join('+') : 'None');
        this._settings.set_string('hotkey-key', key);
        this._recording = false;
        button.label = 'Record';
    }

    _accelerator(modifiers, key) {
        const prefix = modifiers === 'None' ? '' : modifiers.split('+')
            .map(item => `<${item}>`).join('');
        const suffix = key === 'None' ? '' : key.startsWith('D') ? key.slice(1) : key;
        return prefix + suffix;
    }

    _modifiersFromState(state) {
        const modifiers = new Set();
        if (state & Gdk.ModifierType.CONTROL_MASK)
            modifiers.add('Control');
        if (state & Gdk.ModifierType.ALT_MASK)
            modifiers.add('Alt');
        if (state & Gdk.ModifierType.SHIFT_MASK)
            modifiers.add('Shift');
        return modifiers;
    }

    _modifierName(keyval) {
        if (keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R)
            return 'Control';
        if (keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
            keyval === Gdk.KEY_ISO_Level3_Shift)
            return 'Alt';
        if (keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R)
            return 'Shift';
        return null;
    }

    _keyName(keyval) {
        const name = Gdk.keyval_name(keyval);
        if (!name)
            return null;
        if (/^[a-zA-Z]$/.test(name))
            return name.toUpperCase();
        if (/^[0-9]$/.test(name))
            return `D${name}`;
        if (/^F([1-9]|1[0-2])$/.test(name))
            return name;
        if (name === 'space')
            return 'Space';
        if (name === 'Escape')
            return 'Escape';
        return null;
    }
}
