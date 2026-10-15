/* global TextDecoder */
import GLib from 'gi://GLib';
import System from 'system';
import {DoubleControlTracker, LaserActivation, LaserTrail, ShakeDetector} from '../engine.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

class Signals {
    constructor() {
        this.signals = new Map();
        this.nextId = 0;
    }
    connect(name, callback) {
        const id = ++this.nextId;
        this.signals.set(id, {name, callback});
        return id;
    }
    disconnect(id) { assert(this.signals.delete(id), 'a connected signal is removed once'); }
    emit(name, ...args) {
        let result;
        for (const signal of this.signals.values()) {
            if (signal.name === name)
                result = signal.callback(this, ...args);
        }
        return result;
    }
}

class Actor extends Signals {
    constructor(properties = {}) {
        super();
        Object.assign(this, {visible: false, animations: [], repaints: 0}, properties);
    }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    set_position(x, y) { Object.assign(this, {x, y}); }
    set_size(width, height) { Object.assign(this, {width, height}); }
    set_scale(x, y) { Object.assign(this, {scale_x: x, scale_y: y}); }
    set_pivot_point() {}
    set_content() {}
    remove_all_transitions() {}
    ease(animation) { this.animations.push(animation); }
    queue_repaint() { this.repaints++; }
    destroy() { this.destroyed = true; this.hide(); this.signals.clear(); }
}

const Clutter = {
    Actor,
    BindConstraint: class { constructor(properties) { Object.assign(this, properties); } },
    BindCoordinate: {ALL: 0},
    AnimationMode: {EASE_IN_OUT_CUBIC: 0},
    TextureContent: {new_from_texture: () => ({})},
    EVENT_PROPAGATE: false,
    EVENT_STOP: true,
    EventType: {
        KEY_PRESS: 1, KEY_RELEASE: 2, BUTTON_PRESS: 3, BUTTON_RELEASE: 4,
        ENTER: 5, LEAVE: 6, MOTION: 7, SCROLL: 8,
    },
    ModifierType: {
        SHIFT_MASK: 1, CONTROL_MASK: 4, MOD1_MASK: 8, MOD5_MASK: 128,
        BUTTON1_MASK: 256, BUTTON2_MASK: 512, BUTTON3_MASK: 1024,
        BUTTON4_MASK: 2048, BUTTON5_MASK: 4096,
    },
    KEY_Control_L: 65507, KEY_Control_R: 65508,
    KEY_Shift_L: 65505, KEY_Shift_R: 65506,
    KEY_Alt_L: 65513, KEY_Alt_R: 65514, KEY_ISO_Level3_Shift: 65027,
    KEY_Super_L: 65515, KEY_Super_R: 65516,
    keyval_name: symbol => {
        if (symbol >= 32 && symbol <= 126)
            return symbol === 32 ? 'space' : String.fromCharCode(symbol);
        if (symbol >= 65470 && symbol <= 65481)
            return `F${symbol - 65469}`;
        return symbol === 65307 ? 'Escape' : null;
    },
};
const [, bytes] = GLib.file_get_contents(System.programArgs[0] ||
    `${GLib.path_get_dirname(System.programPath)}/../extension.js`);
const source = new TextDecoder().decode(bytes);
const values = {
    'keyboard-enabled': true, 'shake-enabled': false, 'activation-mode': 0,
    'activation-method': 0, 'hotkey-modifiers': 'Control', 'hotkey-key': 'None',
    'require-super': false, 'cursor-size': 6, 'animation-duration-ms': 150,
    'shake-window-ms': 200, 'shake-minimum-speed': 0.5, 'shake-minimum-turns': 2,
    'visible-duration-ms': 1000,
    'hide-system-cursor': true, 'laser-enabled': false, 'laser-activation-mode': 0,
    'laser-hotkey-modifiers': 'Control+Alt', 'laser-hotkey-key': 'None',
};
const settings = Object.assign(new Signals(), {
    get_boolean: key => values[key], get_enum: key => values[key],
    get_int: key => values[key], get_double: key => values[key], get_string: key => values[key],
});
const tracker = Object.assign(new Signals(), {
    get_sprite: () => sprite,
    get_scale: () => 1, get_hot: () => [0, 0],
    get_pointer_visible: () => pointerVisible,
    set_pointer_visible: visible => { pointerVisible = visible; },
});
const stage = new Signals();
const workspace = new Signals();
const layout = Object.assign(new Signals(), {addTopChrome() {}});
const timers = new Map();
const errors = [];
let nextTimer = 0;
let now = 0;
let pointer = [100, 100, 0];
let pointerVisible = true;
let sprite = {get_width: () => 32, get_height: () => 32};
let watchRemoved = false;
let wayland = true;
const observers = [];
class Observer {
    constructor(path, onKey, onStopped) {
        Object.assign(this, {path, onKey, onStopped, ready: false});
        observers.push(this);
    }
    start() { this.started = true; }
    stop() { this.stopped = true; this.ready = false; }
    fail() { this.stop(); this.onStopped('disconnected'); }
}
const ExtensionClass = new Function(
    'Extension', 'Clutter', 'GLib', 'Main', 'global', 'Gio', 'Meta', 'St', 'Shell',
    'LaserIndicator', 'ShakeDetector', 'DoubleControlTracker', 'LaserActivation', 'LaserTrail',
    'PointerWatcher', 'KeyboardObserver', 'console',
    source.slice(source.indexOf('const TRIGGER_KEYS'), source.indexOf('const LaserIndicator')) +
    source.slice(source.indexOf('export default class')).replace('export default ', 'return ')
)(
    class { getSettings() { return settings; } }, Clutter,
    {
        PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
        get_monotonic_time: () => now * 1000,
        timeout_add: (_priority, _interval, callback) => {
            const id = ++nextTimer;
            timers.set(id, callback);
            return id;
        },
        Source: {remove: id => timers.delete(id)},
    },
    {
        uiGroup: {add_child() {}, set_child_above_sibling() {}, set_child_below_sibling() {}},
        layoutManager: layout,
        panel: {statusArea: {quickSettings: {addExternalIndicator() {}}}},
    },
    {backend: {get_cursor_tracker: () => tracker}, stage,
        workspace_manager: workspace, get_pointer: () => pointer},
    {Settings: class { get_int() { return 400; } }},
    {is_wayland_compositor: () => wayland}, {DrawingArea: Actor},
    {util_set_hidden_from_pick: actor => { actor.hiddenFromPick = true; }},
    class { setActive(active) { this.active = active; } destroy() { this.destroyed = true; } },
    ShakeDetector, DoubleControlTracker, LaserActivation, LaserTrail,
    {getPointerWatcher: () => ({addWatch: () => ({remove() { watchRemoved = true; }})})},
    Observer, {log() {}, error: error => errors.push(error)}
);
const extension = new ExtensionClass();
extension.path = '/test/extension';
extension.enable();
function setting(key, value) {
    values[key] = value;
    settings.emit('changed', key);
}
function key(symbol, keycode, pressed, time = now) {
    now = time;
    const result = stage.emit('captured-event', {
        type: () => pressed ? Clutter.EventType.KEY_PRESS : Clutter.EventType.KEY_RELEASE,
        get_key_symbol: () => symbol, get_key_code: () => keycode,
    });
    assert(result === Clutter.EVENT_PROPAGATE, 'keyboard events remain available to applications');
}
function pointerEvent(type, button = 1) {
    return stage.emit('captured-event', {type: () => type, get_button: () => button});
}
function runTimer(id) {
    assert(timers.has(id), 'the expected timer exists');
    if (!timers.get(id)())
        timers.delete(id);
}
function setSprite(width, height) {
    sprite = {get_width: () => width, get_height: () => height};
    tracker.emit('cursor-changed');
}
function move(x, y) {
    now += 10;
    pointer[0] = x;
    pointer[1] = y;
    extension._onPointerMoved(x, y);
}

key(Clutter.KEY_Control_L, 37, true);
assert(extension._desiredActive && !pointerVisible, 'the real Control-only matcher activates');
const firstAnimationCount = extension._actor.animations.length;
key(Clutter.KEY_Control_L, 37, true);
assert(extension._actor.animations.length === firstAnimationCount, 'key repeat preserves animation');
key(Clutter.KEY_Control_L, 37, false);
assert(!extension._desiredActive && pointerVisible, 'Control release ends hold activation');

key(Clutter.KEY_Shift_L, 50, true);
key(65, 38, true);
key(Clutter.KEY_Shift_L, 50, false);
key(97, 38, false);
assert(extension._pressed.size === 0, 'Shift changes do not leave a pressed letter');
key(Clutter.KEY_Control_L, 37, true);
assert(extension._desiredActive, 'a released shifted letter does not block Control activation');
key(Clutter.KEY_Control_L, 37, false);

setting('hotkey-modifiers', 'None');
setting('hotkey-key', 'None');
key(Clutter.KEY_Shift_L, 50, true);
key(Clutter.KEY_Shift_L, 50, false);
assert(!extension._desiredActive, 'stored empty shortcuts never match an idle keyboard');
for (const [name, symbol] of [
    ['A', 97], ['D0', 48], ['D9', 57], ['F1', 65470], ['F12', 65481],
    ['Space', 32], ['Escape', 65307],
]) {
    setting('hotkey-key', name);
    key(symbol, 38, true);
    assert(extension._desiredActive, `the real matcher accepts ${name}`);
    key(0x1000444, 38, false);
    assert(!extension._desiredActive && extension._pressed.size === 0,
        'layout changes on release use the press-time symbol');
}
setting('hotkey-modifiers', 'Control');
setting('hotkey-key', 'None');
setting('activation-mode', 1);
key(Clutter.KEY_Control_L, 37, true);
key(Clutter.KEY_Control_L, 37, true);
key(Clutter.KEY_Control_L, 37, false);
assert(extension._desiredActive, 'toggle survives repeat and release');
key(Clutter.KEY_Control_L, 37, true);
key(Clutter.KEY_Control_L, 37, false);
assert(!extension._desiredActive, 'the next physical press ends toggle activation');

setting('activation-mode', 0);
for (const [method, symbol, code] of [
    [1, Clutter.KEY_Control_L, 37], [2, Clutter.KEY_Control_R, 105],
    [3, Clutter.KEY_Control_L, 37], [3, Clutter.KEY_Control_R, 105],
]) {
    setting('activation-method', method);
    key(symbol, code, true, 0);
    key(symbol, code, false, 20);
    key(symbol, code, true, 130);
    now = 140;
    runTimer(extension._doubleHoldTimeoutId);
    assert(extension._desiredActive, 'each double-Control method accepts its supported side');
    key(symbol, code, true, 150);
    key(symbol, code, false, 160);
    assert(!extension._desiredActive, 'double-Control release ends its hold');
}
setting('activation-method', 1);
setting('require-super', true);
key(Clutter.KEY_Super_L, 133, true, 0);
key(Clutter.KEY_Super_R, 134, true, 1);
key(Clutter.KEY_Control_L, 37, true, 10);
key(Clutter.KEY_Control_L, 37, false, 30);
key(Clutter.KEY_Control_L, 37, true, 140);
now = 150;
runTimer(extension._doubleHoldTimeoutId);
key(Clutter.KEY_Super_L, 133, false, 160);
assert(extension._desiredActive, 'the remaining Super key keeps a double-Control hold active');
key(Clutter.KEY_Super_R, 134, false, 170);
assert(!extension._desiredActive, 'the last Super release ends the hold');
key(Clutter.KEY_Control_L, 37, false, 180);

setting('keyboard-enabled', false);
setting('shake-enabled', true);
for (const size of [24, 32]) {
    setSprite(32, 32);
    setSprite(1, 1);
    const animationsBeforeHandoff = extension._actor.animations.length;
    for (let i = 0; i < 12; i++)
        move(i % 2 ? 980 : 960, 540);
    move(1919, 540);
    setSprite(size, size);
    assert(!extension._shakeHeld && !extension._shakeGestureActive &&
        !extension._shakeTimeoutId && !extension._desiredActive && !extension._actor.visible &&
        extension._shakeDetector._samples.length === 0 &&
        extension._actor.animations.length === animationsBeforeHandoff && timers.size === 0,
        'Deskflow recentering and the return warp do not enlarge the recovered cursor');
    move(1900, 540);
    assert(extension._shakeDetector._samples.length === 1 && !extension._shakeHeld,
        'the first local movement after return starts fresh shake history');
}
for (let i = 0; i < 12; i++)
    move(i % 2 ? 120 : 100, 100);
assert(extension._shakeHeld && extension._shakeGestureActive && extension._shakeTimeoutId &&
    extension._desiredActive && extension._actor.visible,
    'real shake detection still works after a Deskflow return');
const departingShakeTimeout = extension._shakeTimeoutId;
setSprite(1, 1);
assert(!extension._shakeHeld && !extension._shakeGestureActive && !extension._shakeTimeoutId &&
    !timers.has(departingShakeTimeout) && !extension._desiredActive &&
    !extension._actor.visible && pointerVisible,
    'departure removes a prior real shake hold and its enlarged cursor immediately');
setSprite(32, 32);
assert(!extension._desiredActive && !extension._actor.visible,
    'return before the old shake timeout cannot restore its enlargement');

setting('laser-enabled', true);
assert(pointerEvent(Clutter.EventType.BUTTON_PRESS) === Clutter.EVENT_PROPAGATE,
    'inactive laser leaves pointer input available');
pointer[2] = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD5_MASK;
key(Clutter.KEY_Control_L, 37, true);
key(Clutter.KEY_ISO_Level3_Shift, 108, true);
assert(extension._laserActive && extension._laserBlocker.visible,
    'Ctrl+AltGr activates the laser with a pointer blocker');
assert(extension._laserBlocker.reactive && extension._laserBlocker.opacity === 0 &&
    extension._laserArea.hiddenFromPick, 'the blocker receives input while the trail does not');
runTimer(extension._laserPollId);
assert(extension._laserActive, 'polled AltGr does not cancel captured AltGr activation');
for (const type of [Clutter.EventType.ENTER, Clutter.EventType.LEAVE,
    Clutter.EventType.MOTION, Clutter.EventType.SCROLL])
    assert(pointerEvent(type) === Clutter.EVENT_STOP, 'active laser blocks pointer events');
assert(pointerEvent(Clutter.EventType.BUTTON_PRESS, 3) === Clutter.EVENT_STOP &&
    pointerEvent(Clutter.EventType.BUTTON_RELEASE, 3) === Clutter.EVENT_STOP,
    'active laser blocks other buttons without drawing');
pointer[2] |= Clutter.ModifierType.BUTTON1_MASK;
assert(pointerEvent(Clutter.EventType.BUTTON_PRESS) === Clutter.EVENT_STOP,
    'the stroke press is not delivered to applications');
assert(extension._laserLeftButtonDown, 'the captured left press starts a stroke');
setSprite(1, 1);
pointer[0] = 120;
pointer[1] = 115;
extension._onPointerMoved(120, 115);
assert(extension._laserArea.visible && extension._laserArea.repaints > 0 &&
    extension._laserTrail.segments(now).length > 0, 'pointer movement produces a visible laser trail');
assert(extension._shakeDetector._samples.length === 0 && !extension._shakeHeld,
    'shake suppression leaves laser pointer handling active');
setSprite(32, 32);
pointer[2] = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.BUTTON1_MASK;
key(Clutter.KEY_ISO_Level3_Shift, 108, false);
assert(extension._laserActive, 'releasing the shortcut keeps the active stroke blocked');
pointer[2] = Clutter.ModifierType.CONTROL_MASK;
assert(pointerEvent(Clutter.EventType.BUTTON_RELEASE) === Clutter.EVENT_STOP,
    'the stroke release stays blocked');
runTimer(extension._laserPollId);
assert(!extension._laserActive && !extension._laserBlocker.visible && !extension._laserTimerId,
    'button release completes deferred deactivation and removes the render timer');
key(Clutter.KEY_Control_L, 37, false);

pointer[2] = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.BUTTON1_MASK;
extension._updateLaserActivation();
assert(!extension._laserActive && extension._laserActivationPending,
    'an existing application drag delays laser activation');
assert(pointerEvent(Clutter.EventType.BUTTON_RELEASE) === Clutter.EVENT_PROPAGATE,
    'an application drag receives its own release before laser activation');
pointer[2] &= ~Clutter.ModifierType.BUTTON1_MASK;
runTimer(extension._laserPollId);
assert(extension._laserActive, 'laser activation continues after the existing drag ends');
extension._resetLaser('workspace-changed');
assert(!extension._laserActive && !extension._laserBlocker.visible &&
    extension._laserTrail.segments(now).length === 0, 'workspace reset clears laser input and trail');
pointer[2] = 0;
setting('laser-activation-mode', 1);
pointer[2] = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK;
extension._updateLaserActivation();
pointer[2] = 0;
extension._updateLaserActivation();
assert(extension._laserActive, 'laser toggle survives shortcut release');
pointer[2] = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK;
extension._updateLaserActivation();
assert(!extension._laserActive, 'the next laser shortcut press ends toggle activation');
extension._setLaserActive(1);
assert(extension._laserActive === true, 'laser state retains Boolean conversion');
extension._setLaserActive(0);

wayland = false;
pointer[2] = 0;
setting('keyboard-enabled', true);
const observer = observers[0];
assert(observer.started && observer.path.endsWith('/keyboard-helper.js'), 'X11 starts its passive observer');
setting('activation-method', 0);
setting('activation-mode', 1);
key(Clutter.KEY_Control_L, 37, true);
key(Clutter.KEY_Control_L, 37, false);
assert(!extension._desiredActive, 'X11 stage taps are ignored during observer startup');
observer.ready = true;
observer.onKey(37, Clutter.KEY_Control_L, true, 0);
assert(extension._desiredActive, 'the global observer reaches the same shortcut handler');
key(Clutter.KEY_Control_L, 37, true);
assert(extension._desiredActive, 'the same stage press does not toggle twice');
observer.onKey(37, Clutter.KEY_Control_L, false, 10);
setting('activation-mode', 0);
setting('activation-method', 1);
setting('require-super', false);
now = 10000;
observer.onKey(37, Clutter.KEY_Control_L, true, 0);
observer.onKey(37, Clutter.KEY_Control_L, false, 20);
observer.onKey(37, Clutter.KEY_Control_L, true, 130);
runTimer(extension._doubleHoldTimeoutId);
assert(extension._desiredActive, 'batched global events keep their source double-Control intervals');
observer.onKey(37, Clutter.KEY_Control_L, false, 160);
setting('activation-method', 0);
observer.onKey(37, Clutter.KEY_Control_L, true, 20);
assert(extension._desiredActive, 'global hold activation works');
observer.fail();
assert(!extension._desiredActive && extension._pressed.size === 0 &&
    !extension._laserActive, 'observer failure clears held input and removes laser blocking');
assert(observers.length === 1, 'observer failure does not start a restart loop');
setting('keyboard-enabled', false);
setting('keyboard-enabled', true);
const retry = observers[1];
assert(retry.started, 'a later user settings change can retry global input');
retry.ready = true;
setting('activation-mode', 1);
retry.onKey(37, Clutter.KEY_Control_L, true, 30);
retry.onKey(37, Clutter.KEY_Control_L, false, 40);
assert(extension._desiredActive && !pointerVisible, 'a global toggle is active before failure');
retry.fail();
assert(!extension._desiredActive && !extension._toggleActive && pointerVisible &&
    !extension._keyboardObserver, 'observer failure ends toggle activation and restores the system cursor');
assert(observers.length === 2, 'toggle cleanup does not retry on its own');
setting('keyboard-enabled', false);
const finalObserver = observers[2];

const cursor = extension._actor;
const blocker = extension._laserBlocker;
const area = extension._laserArea;
extension._setLaserActive(true);
pointer[2] = Clutter.ModifierType.BUTTON1_MASK;
pointerEvent(Clutter.EventType.BUTTON_PRESS);
extension._onPointerMoved(140, 120);
extension.disable();
assert(finalObserver.stopped && cursor.destroyed && blocker.destroyed && area.destroyed &&
    !blocker.visible && pointerVisible, 'disable stops global input and destroys both overlays');
assert(timers.size === 0 && stage.signals.size === 0 && tracker.signals.size === 0 &&
    settings.signals.size === 0 && workspace.signals.size === 0 && layout.signals.size === 0 &&
    watchRemoved, 'disable removes every input signal, watch, and timer');
assert(errors.length === 0, 'integration paths complete without a guarded error');
print('extension input tests passed');
