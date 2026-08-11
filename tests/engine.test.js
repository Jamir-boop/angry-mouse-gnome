import {DoubleControlTracker, ShakeDetector, isShaking} from '../engine.js';

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

print('engine tests passed');
