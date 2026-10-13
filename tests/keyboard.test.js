import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {KeyboardObserver, parseKeyEvent} from '../keyboard.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

assert(JSON.stringify(parseKeyEvent('[38,65,true,123.5]')) === '[38,65,true,123.5]',
    'the protocol preserves physical code, symbol, press state, and source time');
for (const line of [
    '', 'ready', '{}', 'null', '[38,65,true]', '[38,65,true,1,2]',
    '[0,65,true,1]', '[-1,65,true,1]', '[4294967296,65,true,1]',
    '[38,-1,true,1]', '[38,4294967296,true,1]', '[38,65,1,1]',
    '[38,65,true,-1]', '[38,65,true,1e999]', '[38.5,65,true,1]',
    `${' '.repeat(65)}[38,65,true,1]`,
])
    assert(parseKeyEvent(line) === null, 'malformed or oversized key data is rejected');

const helperPath = GLib.build_filenamev([GLib.path_get_dirname(System.programPath), '..', 'keyboard.js']);
const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
});
launcher.setenv('DISPLAY', '', true);
const entrypoint = launcher.spawnv(['gjs', '-m', helperPath]);
const [, output, error] = entrypoint.communicate_utf8(null, null);
assert(!entrypoint.get_successful() && output === '' &&
    error.includes('Keyboard observer failed to start'),
    'direct module execution reports startup failure instead of silently skipping the entry point');

const directory = GLib.dir_make_tmp('angry-mouse-keyboard-test-XXXXXX');
const scripts = [];
let nextScript = 0;
function script(code) {
    const path = GLib.build_filenamev([directory, `${++nextScript}.js`]);
    GLib.file_set_contents(path, `import GLib from 'gi://GLib';\n${code}`);
    scripts.push(path);
    return path;
}
function readUntilStopped(path) {
    const loop = new GLib.MainLoop(null, false);
    const events = [];
    let reason;
    const observer = new KeyboardObserver(path, (...event) => events.push(event), stopped => {
        reason = stopped;
        loop.quit();
    });
    const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        reason = 'test-timeout';
        observer.stop();
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    observer.start();
    loop.run();
    if (reason !== 'test-timeout')
        GLib.Source.remove(timeout);
    assert(!observer.ready, 'a stopped observer is no longer ready');
    return {events, reason};
}

try {
    const success = readUntilStopped(script("print('ready'); print('[38,65,true,123.5]');"));
    assert(success.reason === 'disconnected' && success.events.length === 1 &&
        JSON.stringify(success.events[0]) === '[38,65,true,123.5]',
        'a real subprocess delivers one event and reports EOF');
    const invalid = readUntilStopped(script("print('ready'); print('[38,65,1,123.5]'); new GLib.MainLoop(null,false).run();"));
    assert(invalid.reason === 'invalid-event' && invalid.events.length === 0,
        'invalid child data stops the process without reaching the key handler');
    const premature = readUntilStopped(script("print('[38,65,true,123.5]');"));
    assert(premature.reason === 'invalid-event' && premature.events.length === 0,
        'a key event cannot precede observer initialization');
    const missing = readUntilStopped(`${directory}/missing.js`);
    assert(missing.reason === 'start-failed' && missing.events.length === 0,
        'child startup failure is reported without a retry');

    const loop = new GLib.MainLoop(null, false);
    let stoppedCallbacks = 0;
    let didStop = false;
    let childExited = false;
    const observer = new KeyboardObserver(
        script("print('ready'); new GLib.MainLoop(null,false).run();"),
        () => {}, () => stoppedCallbacks++);
    observer.start();
    const pid = observer._process.get_identifier();
    const poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        if (!didStop && observer.ready) {
            observer.stop();
            observer.stop();
            didStop = true;
        }
        if (didStop && !GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS)) {
            childExited = true;
            loop.quit();
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
    const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        observer.stop();
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
    if (childExited)
        GLib.Source.remove(timeout);
    else
        GLib.Source.remove(poll);
    assert(didStop && childExited && !observer.ready && stoppedCallbacks === 0 &&
        observer._cancellable.is_cancelled() && !observer._process && !observer._input,
        'explicit stop cancels a pending read, terminates and reaps the child, and suppresses disconnect callbacks');
} finally {
    for (const path of scripts)
        GLib.unlink(path);
    GLib.rmdir(directory);
}
print('keyboard observer tests passed');
