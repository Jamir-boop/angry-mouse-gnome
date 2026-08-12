import {
    DoubleControlTracker,
    LaserActivation,
    LaserTrail,
    ShakeDetector,
    isShaking,
    laserSegmentWidth,
} from '../engine.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function alternatingSamples(step, count = 12) {
    const samples = [];
    for (let i = 0; i < count; i++)
        samples.push({x: i % 2 ? step : 0, y: 0, time: i * 10});
    return samples;
}

assert(!isShaking(alternatingSamples(20, 9), 0.5, 2), 'requires ten samples');
assert(isShaking(alternatingSamples(20), 0.5, 2), 'detects a fast reversal');
assert(!isShaking(alternatingSamples(2), 0.5, 2), 'rejects slow movement');
assert(!isShaking(Array.from({length: 12}, (_, i) => ({x: i * 20, y: 0, time: i * 10})), 0.5, 2),
    'rejects straight movement');

const detector = new ShakeDetector();
for (let i = 0; i < 12; i++)
    detector.push(i % 2 ? 20 : 0, 0, i * 10, 100, 0.5, 2);
assert(detector.push(0, 0, 400, 100, 0.5, 2) === false, 'prunes expired samples');

const controls = new DoubleControlTracker();
assert(controls.press('left', 0, true, 80, 400) === 'first-press', 'starts first tap');
controls.release('left', 30, true);
assert(controls.press('left', 50, true, 80, 400) === 'first-press', 'rejects switch bounce');
controls.release('left', 60, true);
assert(controls.press('left', 160, true, 80, 400) === 'second-press', 'accepts same-side double press');
assert(!controls.confirmHold(169), 'applies hold grace period');
assert(controls.confirmHold(170), 'confirms a held second press');
assert(controls.release('left', 180, true) === 'second-release', 'ends on second release');

controls.cancel();
controls.press('left', 0, true, 80, 400);
controls.release('left', 20, true);
assert(controls.press('right', 120, true, 80, 400) !== 'second-press', 'requires the same physical side');

controls.cancel();
controls.press('left', 0, true, 80, 400);
controls.release('left', 20, true);
assert(controls.press('left', 500, true, 80, 400) !== 'second-press', 'rejects expired taps');

const trail = new LaserTrail();
trail.start(0, 0, 0);
assert(trail.segments(0).length === 0, 'does not draw a single point');
trail.add(10, 20, 10);
let segments = trail.segments(10);
assert(segments.length === 1, 'draws the first segment');
assert(segments[0].end.x === 6 && segments[0].end.y === 12, 'smooths laser points');
const segmentBuffer = segments;
const firstSegment = segments[0];
segments = trail.segments(20);
assert(segments === segmentBuffer && segments[0] === firstSegment,
    'reuses the laser frame buffer');
assert(Math.abs(laserSegmentWidth(0, 500, 59, 60) - 3.75) < 0.001,
    'uses quartic one-second expiry');
assert(laserSegmentWidth(0, 0, 10, 60) === 0, 'tapers to the last fifty samples');
trail.end(10, 20, 10);
assert(trail.segments(1010).length === 0, 'expires laser strokes');

trail.start(0, 0, 0);
trail.add(10, 0, 10);
trail.end(10, 0, 10);
trail.start(100, 100, 500);
trail.add(110, 100, 510);
trail.end(110, 100, 510);
segments = trail.segments(1010);
assert(segments.length > 0 && segments.every(segment => segment.start.x >= 100),
    'expires separate strokes independently');

const laserActivation = new LaserActivation();
assert(laserActivation.update(0, true), 'hold mode activates while pressed');
assert(!laserActivation.update(0, false), 'hold mode stops on release');
assert(laserActivation.update(1, true), 'toggle mode activates on a press edge');
assert(laserActivation.update(1, true), 'toggle mode ignores a held shortcut');
laserActivation.update(1, false);
assert(!laserActivation.update(1, true), 'toggle mode deactivates on the next press');
laserActivation.reset(true);
assert(!laserActivation.update(1, true), 'reset does not retrigger a held shortcut');
laserActivation.update(1, false);
assert(laserActivation.update(1, true), 'reset accepts a new press after release');

print('engine tests passed');
