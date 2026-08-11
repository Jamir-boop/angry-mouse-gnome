import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

import {DoubleControlTracker, ShakeDetector} from './engine.js';

const TRIGGER_KEYS = new Set([
    'shake-enabled', 'keyboard-enabled', 'activation-mode', 'activation-method',
    'require-super', 'hotkey-modifiers', 'hotkey-key', 'shake-window-ms',
    'shake-minimum-speed', 'shake-minimum-turns',
]);

export default class AngryMouseExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._mouseSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.peripherals.mouse'});
        this._cursorTracker = global.backend.get_cursor_tracker();
        this._shakeDetector = new ShakeDetector();
        this._doubleControl = new DoubleControlTracker();
        this._pressed = new Set();
        this._shakeGestureActive = false;
        this._shakeHeld = false;
        this._keyboardHeld = false;
        this._toggleActive = false;
        this._desiredActive = false;
        this._savedPointerVisible = null;
        this._contentReady = false;
        this._lastX = 0;
        this._lastY = 0;
        this._animationSerial = 0;
        this._shakeTimeoutId = 0;
        this._doubleHoldTimeoutId = 0;

        this._actor = new Clutter.Actor({reactive: false, visible: false});
        Main.uiGroup.add_child(this._actor);

        this._settingsSignal = this._settings.connect('changed', (_settings, key) =>
            this._onSettingChanged(key));
        this._cursorSignal = this._cursorTracker.connect('cursor-changed', () =>
            this._refreshCursor());
        this._visibilitySignal = this._cursorTracker.connect('visibility-changed', () =>
            this._enforcePointerVisibility());
        this._keySignal = global.stage.connect('captured-event', (_actor, event) =>
            this._onCapturedEvent(event));
        this._pointerWatch = PointerWatcher.getPointerWatcher().addWatch(10, (x, y) =>
            this._onPointerMoved(x, y));

        this._refreshCursor();
        const [x, y] = global.get_pointer();
        this._lastX = x;
        this._lastY = y;
        this._positionCursor();
    }

    disable() {
        if (this._shakeTimeoutId) {
            GLib.Source.remove(this._shakeTimeoutId);
            this._shakeTimeoutId = 0;
        }
        if (this._doubleHoldTimeoutId) {
            GLib.Source.remove(this._doubleHoldTimeoutId);
            this._doubleHoldTimeoutId = 0;
        }
        if (this._pointerWatch)
            this._pointerWatch.remove();
        if (this._keySignal)
            global.stage.disconnect(this._keySignal);
        if (this._cursorSignal)
            this._cursorTracker.disconnect(this._cursorSignal);
        if (this._visibilitySignal)
            this._cursorTracker.disconnect(this._visibilitySignal);
        if (this._settingsSignal)
            this._settings.disconnect(this._settingsSignal);

        this._desiredActive = false;
        this._hideCursor(true);
        if (this._actor)
            this._actor.destroy();

        this._actor = null;
        this._contentReady = false;
        this._settings = null;
        this._mouseSettings = null;
        this._cursorTracker = null;
        this._pointerWatch = null;
        this._pressed = null;
    }

    _onPointerMoved(x, y) {
        this._lastX = x;
        this._lastY = y;
        this._positionCursor();

        const shakeEnabled = this._settings.get_boolean('shake-enabled') ||
            !this._settings.get_boolean('keyboard-enabled');
        if (!shakeEnabled) {
            this._shakeDetector.reset();
            this._shakeGestureActive = false;
            return;
        }

        const now = GLib.get_monotonic_time() / 1000;
        const shaking = this._shakeDetector.push(
            x,
            y,
            now,
            this._settings.get_int('shake-window-ms'),
            this._settings.get_double('shake-minimum-speed'),
            this._settings.get_int('shake-minimum-turns')
        );

        if (this._settings.get_enum('activation-mode') === 1) {
            if (shaking && !this._shakeGestureActive) {
                this._toggleActive = !this._toggleActive;
                this._updateActive();
            }
        } else if (shaking) {
            this._shakeHeld = true;
            this._clearSource('_shakeTimeoutId');
            this._shakeTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this._settings.get_int('visible-duration-ms'),
                () => {
                    this._shakeTimeoutId = 0;
                    this._shakeHeld = false;
                    this._updateActive();
                    return GLib.SOURCE_REMOVE;
                }
            );
            this._updateActive();
        }
        this._shakeGestureActive = shaking;
    }

    _onCapturedEvent(event) {
        const type = event.type();
        if (type !== Clutter.EventType.KEY_PRESS && type !== Clutter.EventType.KEY_RELEASE)
            return Clutter.EVENT_PROPAGATE;

        const symbol = event.get_key_symbol();
        const pressed = type === Clutter.EventType.KEY_PRESS;
        const repeated = pressed && this._pressed.has(symbol);
        if (pressed)
            this._pressed.add(symbol);

        if (this._settings.get_boolean('keyboard-enabled')) {
            if (this._settings.get_enum('activation-method') === 0)
                this._updateShortcut(repeated);
            else
                this._updateDoubleControl(symbol, pressed, repeated);
        }

        if (!pressed)
            this._pressed.delete(symbol);
        if (!pressed && this._settings.get_boolean('keyboard-enabled') &&
            this._settings.get_enum('activation-method') === 0)
            this._updateShortcut(false);

        return Clutter.EVENT_PROPAGATE;
    }

    _updateShortcut(repeated) {
        const active = this._shortcutMatches();
        if (this._settings.get_enum('activation-mode') === 1) {
            if (active && !this._keyboardHeld && !repeated) {
                this._toggleActive = !this._toggleActive;
                this._updateActive();
            }
            this._keyboardHeld = active;
        } else {
            this._keyboardHeld = active;
            this._updateActive();
        }
    }

    _shortcutMatches() {
        const actualModifiers = [];
        if (this._hasAny(Clutter.KEY_Control_L, Clutter.KEY_Control_R))
            actualModifiers.push('Control');
        if (this._hasAny(Clutter.KEY_Alt_L, Clutter.KEY_Alt_R, Clutter.KEY_ISO_Level3_Shift))
            actualModifiers.push('Alt');
        if (this._hasAny(Clutter.KEY_Shift_L, Clutter.KEY_Shift_R))
            actualModifiers.push('Shift');
        if (this._hasAny(Clutter.KEY_Super_L, Clutter.KEY_Super_R))
            actualModifiers.push('Super');

        const required = this._settings.get_string('hotkey-modifiers').split('+')
            .filter(part => part !== 'None').sort();
        if (actualModifiers.sort().join('+') !== required.join('+'))
            return false;

        const keys = [];
        for (const symbol of this._pressed) {
            if (!this._isModifier(symbol))
                keys.push(this._keyName(symbol) || `Unsupported-${symbol}`);
        }
        const requiredKey = this._settings.get_string('hotkey-key');
        return requiredKey === 'None' ? keys.length === 0 :
            keys.length === 1 && keys[0] === requiredKey;
    }

    _updateDoubleControl(symbol, pressed, repeated) {
        const side = this._controlSide(symbol);
        const requireSuper = this._settings.get_boolean('require-super');
        const superHeld = !requireSuper || this._hasAny(Clutter.KEY_Super_L, Clutter.KEY_Super_R);
        const method = this._settings.get_enum('activation-method');
        const accepted = side && (method === 3 || method === 1 && side === 'left' ||
            method === 2 && side === 'right');

        if (accepted && !repeated) {
            const now = GLib.get_monotonic_time() / 1000;
            const maximum = this._mouseSettings.get_int('double-click');
            const minimum = Math.min(100, maximum / 5);
            const action = pressed
                ? this._doubleControl.press(side, now, superHeld, minimum, maximum)
                : this._doubleControl.release(side, now, superHeld);
            if (action === 'second-press')
                this._startDoubleHoldGrace();
            else if (action === 'second-release') {
                this._clearSource('_doubleHoldTimeoutId');
                if (this._settings.get_enum('activation-mode') === 1)
                    this._toggleActive = !this._toggleActive;
                else
                    this._keyboardHeld = false;
                this._updateActive();
            }
            return;
        }

        const allowedSuper = this._isSuper(symbol) && requireSuper;
        if (!allowedSuper && !repeated) {
            this._doubleControl.cancel();
            this._clearSource('_doubleHoldTimeoutId');
            this._keyboardHeld = false;
            this._updateActive();
        } else if (!pressed && allowedSuper) {
            this._doubleControl.cancel();
            this._clearSource('_doubleHoldTimeoutId');
            this._keyboardHeld = false;
            this._updateActive();
        }
    }

    _startDoubleHoldGrace() {
        this._clearSource('_doubleHoldTimeoutId');
        if (this._settings.get_enum('activation-mode') !== 0)
            return;
        this._doubleHoldTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            this._doubleHoldTimeoutId = 0;
            this._keyboardHeld = this._doubleControl.confirmHold(
                GLib.get_monotonic_time() / 1000);
            this._updateActive();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSettingChanged(key) {
        if (key === 'cursor-size' || key === 'animation-duration-ms') {
            if (this._desiredActive)
                this._showCursor();
            return;
        }
        if (key === 'hide-system-cursor') {
            if (this._settings.get_boolean(key))
                this._enforcePointerVisibility();
            else
                this._restorePointerVisibility();
            return;
        }
        if (TRIGGER_KEYS.has(key)) {
            this._resetTriggers();
            this._updateActive();
        }
    }

    _resetTriggers() {
        this._clearSource('_shakeTimeoutId');
        this._clearSource('_doubleHoldTimeoutId');
        this._shakeDetector.reset();
        this._doubleControl.reset();
        this._shakeGestureActive = false;
        this._shakeHeld = false;
        this._keyboardHeld = false;
        this._toggleActive = false;
    }

    _updateActive() {
        this._desiredActive = this._settings.get_enum('activation-mode') === 1
            ? this._toggleActive
            : this._shakeHeld || this._keyboardHeld;
        if (this._desiredActive)
            this._showCursor();
        else
            this._hideCursor();
    }

    _refreshCursor() {
        if (!this._actor)
            return;
        const sprite = this._cursorTracker.get_sprite();
        if (!sprite) {
            this._contentReady = false;
            this._actor.hide();
            this._restorePointerVisibility();
            return;
        }

        const scale = Math.max(1, this._cursorTracker.get_scale());
        const width = sprite.get_width() / scale;
        const height = sprite.get_height() / scale;
        const [hotX, hotY] = this._cursorTracker.get_hot();
        this._actor.set_content(Clutter.TextureContent.new_from_texture(sprite, null));
        this._actor.set_size(width, height);
        this._actor.set_pivot_point(width ? hotX / width : 0, height ? hotY / height : 0);
        this._cursorWidth = width;
        this._cursorHeight = height;
        this._hotX = hotX;
        this._hotY = hotY;
        this._contentReady = true;
        this._positionCursor();
        if (this._desiredActive)
            this._showCursor();
    }

    _positionCursor() {
        if (this._actor && this._contentReady)
            this._actor.set_position(this._lastX - this._hotX, this._lastY - this._hotY);
    }

    _showCursor() {
        if (!this._actor)
            return;
        if (!this._contentReady) {
            this._refreshCursor();
            return;
        }

        const wasVisible = this._actor.visible;
        const targetScale = 254 * this._settings.get_double('cursor-size') /
            10 / this._cursorHeight;
        const serial = ++this._animationSerial;
        this._actor.remove_all_transitions();
        this._positionCursor();
        this._actor.show();
        Main.uiGroup.set_child_above_sibling(this._actor, null);
        if (!wasVisible)
            this._actor.set_scale(0, 0);
        this._actor.ease({
            scale_x: targetScale,
            scale_y: targetScale,
            duration: this._settings.get_int('animation-duration-ms'),
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            onComplete: () => {
                if (serial !== this._animationSerial)
                    return;
            },
        });
        this._enforcePointerVisibility();
    }

    _hideCursor(immediate = false) {
        this._restorePointerVisibility();
        if (!this._actor || !this._actor.visible)
            return;

        const serial = ++this._animationSerial;
        this._actor.remove_all_transitions();
        if (immediate) {
            this._actor.hide();
            this._actor.set_scale(0, 0);
            return;
        }
        this._actor.ease({
            scale_x: 0,
            scale_y: 0,
            duration: this._settings.get_int('animation-duration-ms'),
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            onComplete: () => {
                if (serial === this._animationSerial)
                    this._actor.hide();
            },
        });
    }

    _enforcePointerVisibility() {
        if (!this._desiredActive || !this._contentReady ||
            !this._settings.get_boolean('hide-system-cursor'))
            return;
        if (this._savedPointerVisible === null)
            this._savedPointerVisible = this._cursorTracker.get_pointer_visible();
        if (this._cursorTracker.get_pointer_visible())
            this._cursorTracker.set_pointer_visible(false);
    }

    _restorePointerVisibility() {
        if (this._savedPointerVisible === null || !this._cursorTracker)
            return;
        this._cursorTracker.set_pointer_visible(this._savedPointerVisible);
        this._savedPointerVisible = null;
    }

    _clearSource(property) {
        if (this[property]) {
            GLib.Source.remove(this[property]);
            this[property] = 0;
        }
    }

    _hasAny(...symbols) {
        return symbols.some(symbol => symbol !== undefined && this._pressed.has(symbol));
    }

    _controlSide(symbol) {
        if (symbol === Clutter.KEY_Control_L)
            return 'left';
        if (symbol === Clutter.KEY_Control_R)
            return 'right';
        return null;
    }

    _isSuper(symbol) {
        return symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R;
    }

    _isModifier(symbol) {
        return this._controlSide(symbol) !== null || this._isSuper(symbol) ||
            symbol === Clutter.KEY_Alt_L || symbol === Clutter.KEY_Alt_R ||
            symbol === Clutter.KEY_Shift_L || symbol === Clutter.KEY_Shift_R ||
            symbol === Clutter.KEY_ISO_Level3_Shift;
    }

    _keyName(symbol) {
        const name = Clutter.keyval_name(symbol);
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
