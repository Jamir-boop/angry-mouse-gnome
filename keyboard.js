import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function parseKeyEvent(line) {
    // The wire format contains two uint32 values, a Boolean, and a millisecond timestamp.
    if (line.length > 64)
        return null;
    let event;
    try {
        event = JSON.parse(line);
    } catch (_error) {
        return null;
    }
    if (!Array.isArray(event) || event.length !== 4 ||
        !Number.isInteger(event[0]) || event[0] <= 0 || event[0] > 0xffffffff ||
        !Number.isInteger(event[1]) || event[1] < 0 || event[1] > 0xffffffff ||
        typeof event[2] !== 'boolean' || !Number.isFinite(event[3]) ||
        event[3] < 0 || event[3] > Number.MAX_SAFE_INTEGER)
        return null;
    return event;
}

export class KeyboardObserver {
    constructor(path, onKey, onStopped) {
        this._path = path;
        this._onKey = onKey;
        this._onStopped = onStopped;
        this._stopped = false;
        this.ready = false;
    }

    start() {
        this._cancellable = new Gio.Cancellable();
        try {
            // A child process lets disable() stop AT-SPI's non-removable key watcher.
            this._process = Gio.Subprocess.new(
                ['gjs', '-m', this._path],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            this._input = new Gio.DataInputStream({base_stream: this._process.get_stdout_pipe()});
            this._read();
        } catch (_error) {
            this._finish('start-failed');
        }
    }

    _read() {
        this._input.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
            let line;
            try {
                [line] = stream.read_line_finish_utf8(result);
            } catch (_error) {
                if (!this._stopped)
                    this._finish('read-failed');
            }
            if (this._stopped) {
                try {
                    stream.close(null);
                } catch (_error) {
                    // A completed stop can already have closed this stream.
                }
                return;
            }
            if (line === null) {
                this._finish(this.ready ? 'disconnected' : 'start-failed');
                return;
            }
            if (line === 'ready' && !this.ready) {
                this.ready = true;
            } else {
                const event = parseKeyEvent(line);
                if (!this.ready || !event) {
                    this._finish('invalid-event');
                    return;
                }
                this._onKey(...event);
            }
            if (!this._stopped)
                this._read();
        });
    }

    _finish(reason) {
        const onStopped = this._onStopped;
        this.stop();
        onStopped?.(reason);
    }

    stop() {
        this._stopped = true;
        this.ready = false;
        this._cancellable?.cancel();
        this._process?.force_exit();
        try {
            this._input?.close(null);
        } catch (_error) {
            // The cancelled read closes its stream when its callback completes.
        }
        this._input = null;
        this._process = null;
        this._onKey = null;
        this._onStopped = null;
    }
}
