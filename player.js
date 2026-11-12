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
    diagnostics.hidden = params.get('debug') !== '1';

    function number(value, fallback, maximum) {
        value = Number(value);
        return isFinite(value) ? Math.max(0, Math.min(maximum, value)) : fallback;
    }
    function report(next, detail) {
        state = next;
        diagnostics.textContent = next + (detail ? ': ' + detail : '');
        console.log('IXTV:' + JSON.stringify({version: 3, state: next, detail: detail || '', decoder: 'wasm-h264-aac'}));
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
                    if (!played || Math.abs(current - time) > 3) {
                        await player.seek(BigInt(Math.floor(time * 1000)));
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
            target = number(value, 0, 43200); targetAt = Date.now(); seekPending = true; apply();
        },
        status: function () {
            var stats = ready && player ? player.getStats() : {};
            return {state: state, ready: ready, played: played, paused: paused, advertising: false, busy: busy,
                time: current, duration: duration, source: streamURL, decoder: 'wasm-h264-aac',
                videoFrames: Number(stats.videoFrameRenderCount || 0), audioFrames: Number(stats.audioFrameRenderCount || 0),
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
        try {
            report('resolving-stream');
            var options = await get('https://rutube.ru/api/play/options/' + id + '/?format=json', true);
            if (!options.acl_access || !options.acl_access.allowed || options.drm_token) throw new Error('Источник не предоставляет открытый поток');
            var master = options.video_balancer && (options.video_balancer.m3u8 || options.video_balancer.default);
            if (!master) throw new Error('Rutube не вернул HLS-поток');
            streamURL = selectVariant(await get(master, false), master);
            duration = number(Number(options.duration) / 1000, 0, 43200);
            if (!duration) throw new Error('Не определена длительность записи');
            if (disposed) return;
            AVPlayer.setLogLevel(2);
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
            player.on('error', function (reason) { error('STREAM_DECODE', String(reason.message || reason)); });
            player.on('ended', function () { active = false; report('ended'); });
            report('loading-stream');
            await player.load(streamURL, {isLive: false, ext: 'm3u8'});
            await player.play({audio: true, video: true, subtitle: false});
            active = ready = true;
            await apply();
        } catch (reason) {
            error('STREAM_UNAVAILABLE', 'Не удалось открыть поток Rutube: ' + String(reason.message || reason));
        }
    }
    var timer = window.setInterval(function () {
        if (disposed) return;
        var audio = window.AVPlayer && AVPlayer.audioContext;
        resume.hidden = !(audio && audio.state === 'suspended');
        if (ready && !busy) {
            var stats = player.getStats();
            if (!paused && active && Number(stats.videoFrameRenderCount) > 1 && current > previous + 0.02) {
                message.hidden = true;
                if (!played) { played = true; console.log('READY:rutube'); }
                if (state !== 'playing') report('playing');
            }
            if (paused && Number(stats.videoFrameRenderCount) > 0) message.hidden = true;
            previous = current;
        }
        if (!played && !paused && state !== 'error' && Date.now() - startedAt > 60000) {
            error('PLAYBACK_TIMEOUT', 'Поток не запустился. Проверьте доступ к Rutube и наличие обновлённого игрового сервиса.');
        }
    }, 250);
    window.addEventListener('resize', function () {
        if (player) player.resize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('pagehide', function () {
        disposed = true; window.clearInterval(timer);
        if (player) player.destroy().catch(function () {});
    });
    start();
}());
