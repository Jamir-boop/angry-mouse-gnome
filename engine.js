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
