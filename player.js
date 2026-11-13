(function () {
    'use strict';
    var params = new URLSearchParams(window.location.hash.slice(1));
    var id = params.get('v') || '';
    var message = document.getElementById('message');
    var diagnostics = document.getElementById('diagnostics');
    var resume = document.getElementById('resume');
    var player, ready = false, played = false, active = false, busy = false, dirty = false, disposed = false;
    var paused = params.get('paused') === '1', volume = number(params.get('volume'), 0, 1);
    var target = number(params.get('t'), 0, 43200), targetAt = Date.now(), startedAt = Date.now();
    var current = 0, previous = 0, duration = 0, state = 'loading', seekPending = true, streamURL = null;
    var initiallySynced = false, seekCount = 0, forceSeek = false, lastSeekAt = 0, lastSeekFrames = 0;
    var restartCount = 0, restartTimer, loading = false, lastProgressAt = Date.now(), decodedFrames = 0;
    diagnostics.hidden = params.get('debug') !== '1';

    function number(value, fallback, maximum) {
        value = Number(value);
        return isFinite(value) ? Math.max(0, Math.min(maximum, value)) : fallback;
    }
    function report(next, detail) {
        state = next;
        lastProgressAt = Date.now();
        diagnostics.textContent = next + (detail ? ': ' + detail : '');
        console.log('IXTV:' + JSON.stringify({version: 6, state: next, detail: detail || '', decoder: 'wasm-h264-aac',
            ready: ready, busy: busy, seekCount: seekCount,
            transport: window.ixStreamStatus ? window.ixStreamStatus() : null,
            renderer: window.ixCanvasVideo ? window.ixCanvasVideo.renderer : null,
            capabilities: window.ixCanvasVideo ? window.ixCanvasVideo.capabilities : null}));
    }
    function error(code, reason) {
        message.textContent = reason + '\nКод: ' + code;
        message.hidden = false;
        report('error', code);
    }
    function desiredTime() {
        return Math.min(duration || 43200, target + (paused ? 0 : Math.max(0, Date.now() - targetAt) / 1000));
    }
    function wakeAudio() {
        if (window.AVPlayer && AVPlayer.audioContext && AVPlayer.audioContext.state === 'suspended') {
            AVPlayer.audioContext.resume().catch(function () {});
        }
    }
    async function apply() {
        dirty = true;
        if (!ready || busy || disposed) return;
        busy = true;
        try {
            while (dirty && !disposed) {
                dirty = false;
                if (seekPending) {
                    seekPending = false;
                    var time = Math.max(0, Math.min(desiredTime(), duration - 0.1));
                    var frames = Number(player.getStats().videoFrameRenderCount || 0);
                    var correctDrift = played && Date.now() - lastSeekAt > 15000 && frames > lastSeekFrames + 15;
                    if (!initiallySynced || forceSeek || (correctDrift && Math.abs(current - time) > 3)) {
                        forceSeek = false;
                        seekCount++;
                        await player.seek(BigInt(Math.floor(time * 1000)));
                        if (disposed) return;
                        initiallySynced = true;
                        lastSeekAt = Date.now();
                        lastSeekFrames = Number(player.getStats().videoFrameRenderCount || 0);
                        current = previous = time;
                    }
                }
                if (paused && active) { await player.pause(); active = false; report('paused'); }
                else if (!paused && !active) { await player.play(); active = true; }
                player.setVolume(volume);
            }
        } catch (reason) { error('STREAM_CONTROL', String(reason.message || reason)); }
        finally { busy = false; }
    }
    window.ixRutube = {
        volume: function (value) { volume = number(value, 0, 1); if (player) player.setVolume(volume); },
        pause: function () {
            target = desiredTime(); targetAt = Date.now(); paused = true; apply();
        },
        play: function () {
            if (paused) { targetAt = Date.now(); startedAt = Date.now(); }
            paused = false; wakeAudio(); apply();
        },
        sync: function (value) {
            var next = number(value, 0, 43200);
            forceSeek = forceSeek || Math.abs(next - desiredTime()) > 3;
            target = next; targetAt = Date.now(); seekPending = true; apply();
        },
        status: function () {
            var stats = {};
            try { if (player) stats = player.getStats() || {}; } catch (_) {}
            return {state: state, ready: ready, played: played, paused: paused, advertising: false, busy: busy,
                initiallySynced: initiallySynced, seekCount: seekCount, visibility: document.visibilityState,
                restarts: restartCount, transport: window.ixStreamStatus ? window.ixStreamStatus() : null,
                time: current, duration: duration, source: streamURL, decoder: 'wasm-h264-aac',
                renderer: window.ixCanvasVideo ? window.ixCanvasVideo.renderer : null, nativeMedia: !!(player && player.useMSE),
                videoFrames: Number(stats.videoFrameRenderCount || 0), audioFrames: Number(stats.audioFrameRenderCount || 0),
                videoDecoded: Number(stats.videoFrameDecodeCount || 0), audioDecoded: Number(stats.audioFrameDecodeCount || 0),
                videoTime: Number(stats.videoCurrentTime || 0) / 1000, audioTime: Number(stats.audioCurrentTime || 0) / 1000,
                videoCodec: stats.videocodec || null, audioCodec: stats.audiocodec || null};
        }
    };
    resume.addEventListener('click', function () { window.ixRutube.play(); });

    async function get(address, json) {
        var response = await window.fetch(address, {cache: 'no-store'});
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return json ? response.json() : response.text();
    }
    function selectVariant(text, address) {
        var height = null, variants = [];
        text.split(/\r?\n/).forEach(function (line) {
            line = line.trim();
            if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
                var match = /RESOLUTION=\d+x(\d+)/.exec(line);
                height = match ? Number(match[1]) : null;
            } else if (line && line[0] !== '#' && height !== null) {
                variants.push({height: height, url: new URL(line, address).href}); height = null;
            }
        });
        if (!variants.length) throw new Error('Нет вариантов HLS-потока');
        variants.sort(function (a, b) { return a.height - b.height; });
        var suitable = variants.filter(function (entry) { return entry.height <= 240; });
        return (suitable.length ? suitable[suitable.length - 1] : variants[0]).url;
    }
    async function start() {
        if (!/^[a-f0-9]{32}$/.test(id)) { error('INVALID_VIDEO', 'Не указан корректный ID кассеты.'); return; }
        if (!window.AVPlayer || !window.WebAssembly) { error('DECODER_UNAVAILABLE', 'Не загрузился программный декодер.'); return; }
        if (!window.ixCanvasVideo || !window.ixCanvasVideo.installed) { error('RENDERER_UNAVAILABLE', 'Не загрузился программный вывод Canvas 2D.'); return; }
        loading = true;
        try {
            report('resolving-stream');
            var options = await get('https://rutube.ru/api/play/options/' + id + '/?format=json', true);
            if (!options.acl_access || !options.acl_access.allowed || options.drm_token) {
                error('SOURCE_ACCESS', 'Источник не предоставляет открытый поток.'); return;
            }
            var master = options.video_balancer && (options.video_balancer.m3u8 || options.video_balancer.default);
            if (!master) throw new Error('Rutube не вернул HLS-поток');
            streamURL = selectVariant(await get(master, false), master);
            duration = number(Number(options.duration) / 1000, 0, 43200);
            if (!duration) throw new Error('Не определена длительность записи');
            if (disposed) return;
            AVPlayer.setLogLevel(3);
            player = new AVPlayer({
                container: document.getElementById('screen'), enableHardware: false, enableWebCodecs: false,
                enableWebGPU: false, enableWorker: false, enableAudioWorklet: false, preLoadTime: 2,
                checkUseMSE: function () { return false; },
                getWasm: function (type, codec) {
                    if (type === 'decoder' && codec === 27) return 'vendor/libmedia/decode/h264.wasm';
                    if (type === 'decoder' && codec === 86018) return 'vendor/libmedia/decode/aac.wasm';
                    if (type === 'resampler') return 'vendor/libmedia/resample/resample.wasm';
                    if (type === 'stretchpitcher') return 'vendor/libmedia/stretchpitch/stretchpitch.wasm';
                    throw new Error('Неподдерживаемый кодек: ' + codec);
                }
            });
            player.setVolume(0);
            player.on('time', function (pts) { current = Number(pts) / 1000; });
            player.on('error', function (reason) {
                if (!loading && !disposed) error('STREAM_DECODE', String(reason.message || reason));
            });
            player.on('ended', function () { active = false; report('ended'); });
            report('loading-stream');
            await player.load(streamURL, {isLive: false, ext: 'm3u8'});
            report('starting-decoder');
            await player.play({audio: true, video: true, subtitle: false});
            wakeAudio();
            active = ready = true;
            report('synchronizing');
            await apply();
        } catch (reason) {
            if (disposed) return;
            ready = active = false;
            if (player) { try { await player.destroy(); } catch (_) {} player = null; }
            if (disposed) return;
            if (restartCount < 2) {
                restartCount++;
                initiallySynced = false; seekPending = true;
                startedAt = Date.now();
                report('retrying-stream', String(reason.message || reason));
                restartTimer = window.setTimeout(start, 1500 * restartCount);
            } else error('STREAM_UNAVAILABLE', 'Не удалось открыть поток Rutube: ' + String(reason.message || reason));
        } finally { loading = false; }
    }
    var timer = window.setInterval(function () {
        if (disposed) return;
        var audio = window.AVPlayer && AVPlayer.audioContext;
        resume.hidden = !(audio && audio.state === 'suspended');
        if (ready && !busy) {
            var stats = player.getStats();
            if (Number(stats.videoFrameDecodeCount || 0) > decodedFrames) {
                decodedFrames = Number(stats.videoFrameDecodeCount);
                lastProgressAt = Date.now();
            }
            if (!paused && active && Number(stats.videoFrameRenderCount) > 1 && current > previous + 0.02) {
                message.hidden = true;
                if (!played) { played = true; console.log('READY:rutube'); }
                if (state !== 'playing') report('playing');
            }
            if (paused && Number(stats.videoFrameRenderCount) > 0) message.hidden = true;
            previous = current;
        }
        var transport = window.ixStreamStatus && window.ixStreamStatus();
        var progress = Math.max(lastProgressAt, transport ? transport.lastProgress : 0);
        if (!played && !paused && state !== 'error' && (Date.now() - progress > 120000 || Date.now() - startedAt > 240000)) {
            error('PLAYBACK_TIMEOUT', 'Поток не запустился. Проверьте доступ к Rutube и наличие обновлённого игрового сервиса.');
        }
    }, 250);
    window.addEventListener('resize', function () {
        if (player) player.resize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('unhandledrejection', function (event) {
        if (disposed) return;
        var reason = event.reason;
        error('STREAM_RUNTIME', String(reason && reason.message || reason || 'Ошибка выполнения декодера'));
    });
    window.addEventListener('pagehide', function () {
        disposed = true; window.clearInterval(timer);
        window.clearTimeout(restartTimer);
        if (player) player.destroy().catch(function () {});
    });
    var started = false;
    window.ixStreamStart = function () {
        if (!started && window.ixStreamReady) { started = true; start(); }
    };
    if (window.ixStreamReady) window.ixStreamStart();
    else report('waiting-game-bridge');
}());
