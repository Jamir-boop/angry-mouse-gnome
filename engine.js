export function isShaking(samples, minimumSpeed, minimumTurns) {
    if (samples.length < 10)
        return false;

    let speed = 0;
    let segments = 0;
    let turns = 0;
    let previousVector = null;

    for (let i = 1; i < samples.length; i++) {
        const dx = samples[i].x - samples[i - 1].x;
        const dy = samples[i].y - samples[i - 1].y;
        const dt = samples[i].time - samples[i - 1].time;
        if (dt <= 0)
            continue;

        speed += Math.hypot(dx, dy) / dt;
        segments++;
        if (previousVector && previousVector.x * dx + previousVector.y * dy < 0)
            turns++;
        if (dx !== 0 || dy !== 0)
            previousVector = {x: dx, y: dy};
    }

    return segments > 0 && speed / segments >= minimumSpeed && turns >= minimumTurns;
}

export class ShakeDetector {
    constructor() {
        this.reset();
    }

    reset() {
        this._samples = [];
        this._lastSampleTime = -Infinity;
    }

    push(x, y, time, windowMs, minimumSpeed, minimumTurns) {
        if (time - this._lastSampleTime < 10)
            return isShaking(this._samples, minimumSpeed, minimumTurns);

        this._lastSampleTime = time;
        this._samples.push({x, y, time});
        while (this._samples.length && this._samples[0].time < time - windowMs)
            this._samples.shift();
        return isShaking(this._samples, minimumSpeed, minimumTurns);
    }
}

export class DoubleControlTracker {
    constructor() {
        this.reset();
    }

    reset() {
        this._firstDown = null;
        this._lastTap = null;
        this._secondDown = null;
        this._pendingUntil = 0;
    }

    press(side, time, superHeld, minimumInterval, maximumInterval) {
        if (this._firstDown === side || this._secondDown === side)
            return 'none';

        if (this._lastTap && this._lastTap.side === side && this._lastTap.superHeld &&
            superHeld && time - this._lastTap.time >= minimumInterval &&
            time - this._lastTap.time <= maximumInterval) {
            this._firstDown = null;
            this._lastTap = null;
            this._secondDown = side;
            this._pendingUntil = time + 10;
            return 'second-press';
        }

        this._firstDown = side;
        this._lastTap = null;
        return 'first-press';
    }

    release(side, time, superHeld) {
        if (this._secondDown === side) {
            this._secondDown = null;
            this._pendingUntil = 0;
            return 'second-release';
        }
        if (this._firstDown === side) {
            this._firstDown = null;
            this._lastTap = {side, time, superHeld};
            return 'first-release';
        }
        return 'none';
    }

    confirmHold(time) {
        return this._secondDown !== null && time >= this._pendingUntil;
    }

    cancel() {
        this.reset();
    }
}

const LASER_MAXIMUM_WIDTH = 4;
const LASER_TAPER_LENGTH = 50;
const LASER_LIFETIME_MS = 1000;
const LASER_SMOOTHING = 0.6;

function easeOutQuart(value) {
    const inverse = 1 - Math.max(0, Math.min(1, value));
    const squared = inverse * inverse;
    return 1 - squared * squared;
}

export function laserSegmentWidth(timestamp, now, index, length) {
    const time = Math.max(0, 1 - (now - timestamp) / LASER_LIFETIME_MS);
    const taper = (LASER_TAPER_LENGTH - Math.min(LASER_TAPER_LENGTH, length - index)) /
        LASER_TAPER_LENGTH;
    return LASER_MAXIMUM_WIDTH * Math.min(easeOutQuart(taper), easeOutQuart(time));
}

export class LaserTrail {
    constructor() {
        this._segmentPool = [];
        this._segments = [];
        this.clear();
    }

    clear() {
        this._strokes = [];
        this._activeStroke = null;
        this._segments.length = 0;
    }

    start(x, y, time) {
        this._prune(time);
        this._activeStroke = {last: {x, y}, samples: [{x, y, time}]};
        this._strokes.push(this._activeStroke);
    }

    add(x, y, time) {
        if (!this._activeStroke)
            return false;

        this._prune(time);
        const previous = this._activeStroke.last;
        const point = {
            x: previous.x + (x - previous.x) * LASER_SMOOTHING,
            y: previous.y + (y - previous.y) * LASER_SMOOTHING,
            time,
        };
        if (point.x === previous.x && point.y === previous.y)
            return false;

        this._activeStroke.last = point;
        this._activeStroke.samples.push(point);
        return true;
    }

    end(x, y, time) {
        if (!this._activeStroke)
            return;

        this.add(x, y, time);
        if (this._activeStroke.samples.length < 2)
            this._strokes.splice(this._strokes.indexOf(this._activeStroke), 1);
        this._activeStroke = null;
    }

    segments(now) {
        this._prune(now);
        this._segments.length = 0;
        let count = 0;
        for (const stroke of this._strokes) {
            for (let i = 1; i < stroke.samples.length; i++) {
                const end = stroke.samples[i];
                const width = laserSegmentWidth(end.time, now, i, stroke.samples.length);
                if (width <= 0)
                    continue;
                const segment = this._segmentPool[count] ??
                    (this._segmentPool[count] = {start: null, end: null, width: 0});
                segment.start = stroke.samples[i - 1];
                segment.end = end;
                segment.width = width;
                this._segments.push(segment);
                count++;
            }
        }
        return this._segments;
    }

    _prune(now) {
        for (let i = this._strokes.length - 1; i >= 0; i--) {
            const stroke = this._strokes[i];
            while (stroke.samples.length && now - stroke.samples[0].time >= LASER_LIFETIME_MS)
                stroke.samples.shift();
            if (stroke !== this._activeStroke && stroke.samples.length < 2)
                this._strokes.splice(i, 1);
        }
    }
}

export class LaserActivation {
    constructor() {
        this.reset();
    }

    reset(shortcutPressed = false) {
        this._shortcutPressed = shortcutPressed;
        this._active = false;
        this._effectiveActive = false;
        this.pending = false;
    }

    update(mode, shortcutPressed, pointerPressed = false) {
        if (mode === 0)
            this._active = shortcutPressed;
        else if (shortcutPressed && !this._shortcutPressed)
            this._active = !this._active;
        this._shortcutPressed = shortcutPressed;

        if (!this._active) {
            this.pending = false;
            if (!pointerPressed)
                this._effectiveActive = false;
        } else if (!this._effectiveActive) {
            this.pending = pointerPressed;
            this._effectiveActive = !pointerPressed;
        }
        return this._effectiveActive;
    }
}
