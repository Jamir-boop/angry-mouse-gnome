/* global TextDecoder */
import GLib from 'gi://GLib';
import System from 'system';
import {DoubleControlTracker, ShakeDetector} from '../engine.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const [, bytes] = GLib.file_get_contents(System.programArgs[0] ||
    `${GLib.path_get_dirname(System.programPath)}/../extension.js`);
const source = new TextDecoder().decode(bytes);
const settings = {
    'activation-mode': 0,
    'shake-enabled': true,
    'keyboard-enabled': true,
    'hide-system-cursor': true,
    'shake-window-ms': 100,
    'shake-minimum-speed': 0.5,
    'shake-minimum-turns': 2,
    'visible-duration-ms': 1000,
    'cursor-size': 2,
    'animation-duration-ms': 200,
};
const animations = [];
const positions = [];
const timers = new Map();
let now = 0;
let nextTimerId = 0;
let shortcutPressed = false;
let pointerVisible = true;
let destroyed = false;
let sprite = {get_width: () => 32, get_height: () => 32};
let cursorScale = 1;
let hotspot = [0, 0];
const actor = {
    visible: false,
    width: 32,
    height: 32,
    scale_x: 1,
    scale_y: 1,
    transition: null,
    show() { this.visible = true; },
    hide() { this.visible = false; },
    ease(animation) {
        animations.push(animation);
        this.transition = {animation, scaleX: this.scale_x, scaleY: this.scale_y};
    },
    remove_all_transitions() { this.transition = null; },
    set_position(x, y) {
        this.x = x;
        this.y = y;
        positions.push([x, y]);
    },
    set_scale(x, y) {
        this.scale_x = x;
        this.scale_y = y;
    },
    set_content() {},
    set_size(width, height) {
        this.width = width;
        this.height = height;
    },
    set_pivot_point(x, y) {
        this.pivot_x = x;
        this.pivot_y = y;
    },
    destroy() { destroyed = true; },
};
const ExtensionClass = new Function(
    'Extension', 'Clutter', 'GLib', 'Main', 'global', 'logEvent', 'TRIGGER_KEYS',
    source.slice(source.indexOf('export default class')).replace('export default ', 'return ')
)(
    class {},
    {
        AnimationMode: {EASE_IN_OUT_CUBIC: 0},
        TextureContent: {new_from_texture: () => ({})},
    },
    {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        get_monotonic_time: () => now * 1000,
        timeout_add: (_priority, _interval, callback) => {
            const id = ++nextTimerId;
            timers.set(id, callback);
            return id;
        },
        Source: {remove: id => timers.delete(id)},
    },
    {uiGroup: {set_child_above_sibling() {}}},
    {get_pointer: () => [0, 0, 0]},
    () => {},
    new Set(['activation-mode'])
);
const extension = Object.assign(new ExtensionClass(), {
    _settings: {
        get_boolean: key => settings[key],
        get_enum: key => settings[key],
        get_int: key => settings[key],
        get_double: key => settings[key],
    },
    _actor: actor,
    _cursorTracker: {
        get_sprite: () => sprite,
        get_scale: () => cursorScale,
        get_hot: () => hotspot,
        get_pointer_visible: () => pointerVisible,
        set_pointer_visible: visible => { pointerVisible = visible; },
    },
    _shakeDetector: new ShakeDetector(),
    _doubleControl: new DoubleControlTracker(),
    _shakeSuppressed: false,
    _shakeGestureActive: false,
    _shakeHeld: false,
    _keyboardHeld: false,
    _toggleActive: false,
    _desiredActive: false,
    _savedPointerVisible: null,
    _contentReady: true,
    _hotX: 0,
    _hotY: 0,
    _lastX: 0,
    _lastY: 0,
    _animationSerial: 0,
    _shakeTimeoutId: 0,
    _doubleHoldTimeoutId: 0,
    _shortcutMatches: () => shortcutPressed,
    _setLaserActive() {},
    _destroyLaserSurface() {},
});

function sampleAnimation(progress) {
    const transition = actor.transition;
    assert(transition, 'an animation is in progress');
    const {animation, scaleX, scaleY} = transition;
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    actor.set_scale(
        scaleX + (animation.scale_x - scaleX) * eased,
        scaleY + (animation.scale_y - scaleY) * eased);
    if (progress === 1) {
        actor.transition = null;
        animation.onComplete?.();
    }
}

function setSprite(width, height, scale = 1, hotX = 0, hotY = 0) {
    sprite = width === null ? null : {get_width: () => width, get_height: () => height};
    cursorScale = scale;
    hotspot = [hotX, hotY];
    extension._refreshCursor();
}

function assertHeight(expected, message) {
    const height = actor.height * actor.scale_y;
    assert(Number.isFinite(height) && Math.abs(height - expected) < 1e-8, message);
}

extension._refreshCursor();
positions.length = 0;
extension._updateActive();
for (let i = 0; i < 20; i++) {
    now = i * 10;
    extension._onPointerMoved(i % 2 ? 20 : 0, 0);
    if (i === 8)
        assert(positions.length === 0, 'hidden pointer samples do not position the cursor actor');
    if (i === 9)
        assert(positions.length === 1 && positions[0][0] === 20 && positions[0][1] === 0,
            'first shake activation positions the cursor at the current sample');
    if (i === 10)
        assert(positions.length === 2 && positions[1][0] === 0,
            'the visible cursor follows the next pointer sample');
}
assert(animations.length === 1, 'repeated shake samples start one enlargement animation');
assert(extension._desiredActive && !pointerVisible, 'first activation hides the system cursor');
shortcutPressed = true;
extension._updateShortcut(false);
extension._updateShortcut(true);
assert(animations.length === 1, 'an overlapping keyboard hold does not restart enlargement');
shortcutPressed = false;
extension._updateShortcut(false);
assert(extension._desiredActive && animations.length === 1,
    'keyboard release keeps the shake hold active');
shortcutPressed = true;
extension._updateShortcut(false);
timers.get(extension._shakeTimeoutId)();
assert(!extension._shakeHeld && extension._desiredActive && animations.length === 1,
    'shake expiry keeps the keyboard hold active');
shortcutPressed = false;
extension._updateShortcut(false);
extension._updateActive();
assert(!extension._desiredActive && pointerVisible && animations.length === 2,
    'the final release starts one hide animation');
assert(animations[1].scale_x === 0, 'deactivation shrinks the cursor');
settings['shake-enabled'] = false;
const positionsBeforeHide = positions.length;
extension._onPointerMoved(40, 50);
assert(positions.length === positionsBeforeHide + 1 &&
    positions[positions.length - 1][0] === 40 && positions[positions.length - 1][1] === 50,
    'the cursor follows pointer movement during its hide animation');
sampleAnimation(1);
extension._onPointerMoved(80, 90);
assert(!actor.visible && positions.length === positionsBeforeHide + 1,
    'pointer movement stops positioning the cursor after the hide animation');
settings['shake-enabled'] = true;

settings['activation-mode'] = 1;
extension._onSettingChanged('activation-mode');
shortcutPressed = true;
extension._updateShortcut(false);
extension._updateShortcut(true);
shortcutPressed = false;
extension._updateShortcut(false);
assert(extension._desiredActive && animations.length === 3,
    'toggle activation stays active through repeat and release');
assert(positions[positions.length - 1][0] === 80 && positions[positions.length - 1][1] === 90,
    'keyboard activation uses the last hidden pointer position');
shortcutPressed = true;
extension._updateShortcut(false);
extension._updateActive();
assert(!extension._desiredActive && animations.length === 4,
    'the next press starts one toggle hide animation');
shortcutPressed = false;
extension._updateShortcut(false);
shortcutPressed = true;
extension._updateShortcut(false);

settings['cursor-size'] = 3;
extension._onSettingChanged('cursor-size');
assert(animations.length === 6 && animations[5].scale_x * actor.height === 254 * 3 / 10,
    'cursor size changes refresh an active cursor');
settings['animation-duration-ms'] = 300;
extension._onSettingChanged('animation-duration-ms');
assert(animations.length === 7 && animations[6].duration === 300,
    'animation duration changes refresh an active cursor');
extension._refreshCursor();
extension._updateActive();
assert(animations.length === 7, 'cursor shape refresh does not restart the active animation');

settings['cursor-size'] = 6;
extension._onSettingChanged('cursor-size');
setSprite(1, 1);
sampleAnimation(1);
const selectedHeight = 152.4;
assertHeight(selectedHeight, 'a tiny sprite reaches the selected cursor height');
setSprite(32, 32);
assertHeight(selectedHeight, 'a full-size sprite does not inherit a huge scale from a tiny sprite');
assert(!actor.transition, 'replacing a fully grown cursor does not start an animation');

setSprite(32, 48, 2, 3, 6);
assertHeight(selectedHeight, 'the selected height is independent of sprite and monitor scale');
assert(Math.abs(actor.width * actor.scale_x - selectedHeight * 2 / 3) < 1e-8,
    'the cursor keeps the sprite aspect ratio');
assert(actor.x + actor.width * actor.pivot_x === extension._lastX &&
    actor.y + actor.height * actor.pivot_y === extension._lastY,
    'the cursor pivot stays at the pointer position');
assert(Math.abs(actor.width * actor.pivot_x * actor.scale_x - selectedHeight * 3 / 48) < 1e-8 &&
    Math.abs(actor.height * actor.pivot_y * actor.scale_y - selectedHeight * 6 / 48) < 1e-8,
    'the raw image hotspot remains at the pointer despite tracker scale');

extension._hideCursor(true);
setSprite(1, 1);
sampleAnimation(0.5);
assertHeight(selectedHeight / 2, 'activation still grows from zero');
const showTransition = actor.transition;
setSprite(48, 24);
assertHeight(selectedHeight / 2, 'a sprite change keeps the current activation height');
assert(actor.transition === showTransition && showTransition.animation.duration === 300,
    'sprite changes preserve the show transition and its duration');
for (const progress of [0.75, 1]) {
    sampleAnimation(progress);
    const height = actor.height * actor.scale_y;
    assert(height >= selectedHeight / 2 && height <= selectedHeight,
        'activation stays within the selected height after a sprite change');
}

extension._toggleActive = false;
extension._updateActive();
const hideAnimation = actor.transition.animation;
sampleAnimation(0.5);
assertHeight(selectedHeight / 2, 'deactivation shrinks from the selected height');
for (const size of [64, 24]) {
    setSprite(size, size);
    assertHeight(selectedHeight / 2, 'sprite changes keep the current deactivation height');
    assert(actor.transition.animation === hideAnimation,
        'sprite changes do not restart the hide animation');
}
sampleAnimation(0.75);
assertHeight(selectedHeight / 16, 'the same cubic hide animation keeps shrinking');
sampleAnimation(1);
assert(!actor.visible && pointerVisible, 'the hide animation finishes after sprite changes');

extension._toggleActive = true;
extension._updateActive();
sampleAnimation(1);
extension._toggleActive = false;
extension._updateActive();
const staleHide = actor.transition.animation;
setSprite(null);
assert(!extension._contentReady && !actor.visible && pointerVisible && !actor.transition,
    'a missing sprite stops animation and restores the system cursor');
extension._toggleActive = true;
extension._updateActive();
setSprite(24, 32);
sampleAnimation(0.5);
staleHide.onComplete();
assert(actor.visible && !pointerVisible, 'a stale hide callback cannot hide a recovered cursor');
assertHeight(selectedHeight / 2, 'sprite recovery starts a new activation animation');
sampleAnimation(1);

for (const [width, height] of [
    [0, 32], [32, 0], [32, NaN], [32, Infinity],
]) {
    setSprite(width, height);
    assert(!extension._contentReady && !actor.visible && pointerVisible && !actor.transition,
        'invalid sprite geometry is hidden without an invalid animation');
    setSprite(32, 32);
    sampleAnimation(1);
    assertHeight(selectedHeight, 'a valid sprite recovers after invalid geometry');
}

extension._toggleActive = false;
extension._updateActive();
sampleAnimation(1);
settings['activation-mode'] = 0;
extension._onSettingChanged('activation-mode');
for (let i = 0; i < 9; i++) {
    now += 10;
    extension._onPointerMoved(i % 2 ? 20 : 0, 0);
}
const shapeHistory = extension._shakeDetector._samples;
const animationsBeforeShape = animations.length;
setSprite(24, 32);
assert(extension._shakeDetector._samples === shapeHistory && shapeHistory.length === 9 &&
    animations.length === animationsBeforeShape,
    'ordinary shape changes retain shake history without starting an animation');
now += 10;
extension._onPointerMoved(20, 0);
assert(extension._shakeHeld && extension._shakeGestureActive && extension._desiredActive,
    'the retained history completes a real shake');
const missingSpriteTimeout = extension._shakeTimeoutId;
setSprite(null);
assert(!extension._shakeHeld && !extension._shakeGestureActive && !extension._shakeTimeoutId &&
    !timers.has(missingSpriteTimeout) && extension._shakeDetector._samples.length === 0 &&
    !extension._desiredActive && !actor.visible && pointerVisible,
    'a missing sprite clears only shake activation and its timer');
for (let i = 0; i < 12; i++) {
    now += 10;
    extension._onPointerMoved(i % 2 ? 980 : 960, 540);
}
setSprite(32, 32);
assert(extension._shakeDetector._samples.length === 0 && !extension._desiredActive &&
    !actor.visible, 'sprite recovery starts with empty shake history and no overlay');
for (let i = 0; i < 10; i++) {
    now += 10;
    extension._onPointerMoved(i % 2 ? 20 : 0, 0);
}
assert(extension._shakeHeld && extension._desiredActive,
    'a real shake activates after sprite recovery');
sampleAnimation(1);
const expiringShakeTimeout = extension._shakeTimeoutId;
timers.get(expiringShakeTimeout)();
timers.delete(expiringShakeTimeout);
const interruptedHide = actor.transition.animation;
sampleAnimation(0.5);
setSprite(1, 1);
assert(!actor.visible && !actor.transition && actor.scale_y === 0 && pointerVisible,
    'the handoff boundary stops a partly finished shake hide immediately');
const animationsBeforeReturn = animations.length;
setSprite(24, 32);
interruptedHide.onComplete();
assert(!extension._desiredActive && !actor.visible && !actor.transition &&
    animations.length === animationsBeforeReturn,
    'a fast return does not expose the partly hidden enlarged cursor');

shortcutPressed = true;
extension._updateShortcut(false);
sampleAnimation(0.5);
const keyboardShow = actor.transition;
setSprite(1, 1);
setSprite(32, 32);
assert(extension._keyboardHeld && extension._desiredActive && actor.visible &&
    actor.transition === keyboardShow,
    'handoff boundaries preserve keyboard hold and its enlargement animation');
sampleAnimation(1);
shortcutPressed = false;
extension._updateShortcut(false);
sampleAnimation(1);
settings['activation-mode'] = 1;
extension._onSettingChanged('activation-mode');
shortcutPressed = true;
extension._updateShortcut(false);
sampleAnimation(1);
const animationsBeforeToggleHandoff = animations.length;
setSprite(1, 1);
setSprite(32, 32);
assert(extension._toggleActive && extension._desiredActive && actor.visible &&
    animations.length === animationsBeforeToggleHandoff,
    'handoff boundaries preserve the shared user toggle without restarting enlargement');
assertHeight(selectedHeight, 'the user toggle keeps the selected cursor height after handoff');

settings['hide-system-cursor'] = false;
extension._onSettingChanged('hide-system-cursor');
setSprite(1, 1);
assert(actor.visible && pointerVisible, 'sprite refresh respects the system cursor visibility setting');
settings['hide-system-cursor'] = true;
extension._onSettingChanged('hide-system-cursor');
assert(!pointerVisible, 'the system cursor can still be hidden while active');
const animationsBeforeDisable = animations.length;
extension.disable();
assert(!actor.visible && destroyed && pointerVisible && !extension._desiredActive &&
    animations.length === animationsBeforeDisable, 'disable hides the cursor immediately');

print('extension tests passed');
