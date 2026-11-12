(function () {
    'use strict';
    var params = new URLSearchParams(window.location.hash.slice(1));
    var id = params.get('v') || '';
    var message = document.getElementById('message');
    var diagnostics = document.getElementById('diagnostics');
    var resume = document.getElementById('resume');
    var video = document.createElement('video');
    var codecs = {webm: video.canPlayType('video/webm; codecs="vp8, vorbis"') !== ''};
    var ready = false, played = false, failed = false, advancing = false;
    var paused = params.get('paused') === '1';
    var target = number(params.get('t'), 0, 43200);
    var volume = number(params.get('volume'), 0, 1);
    var targetAt = Date.now(), startedAt = Date.now(), previousTime = 0, state = 'loading';
    var lastSeek = -Infinity, record = null;
    diagnostics.hidden = params.get('debug') !== '1';

    function number(value, fallback, maximum) {
        value = Number(value);
        return isFinite(value) ? Math.max(0, Math.min(maximum, value)) : fallback;
    }
    function report(next, detail) {
        state = next;
        diagnostics.textContent = next + (detail ? ': ' + detail : '');
        console.log('IXTV:' + JSON.stringify({version: 2, state: next, detail: detail || '', codecs: codecs}));
    }
    function error(code, text) {
        failed = true;
        message.textContent = text + '\nКод: ' + code;
        message.hidden = false;
        resume.hidden = code !== 'AUTOPLAY_BLOCKED';
        report('error', code);
    }
    function desiredTime() {
        return target + (paused ? 0 : Math.max(0, Date.now() - targetAt) / 1000);
    }
    function sound() {
        video.volume = volume;
        video.muted = volume === 0;
    }
    function sync(force) {
        if (!ready || video.seeking) return;
        var time = Math.min(desiredTime(), Math.max(0, video.duration - 0.1));
        if ((force || Math.abs(video.currentTime - time) > 3) && Date.now() - lastSeek >= 2000) {
            try {
                video.currentTime = time;
                previousTime = time;
                lastSeek = Date.now();
            } catch (_) {}
        }
    }
    function play() {
        if (!ready || paused || !video.paused || video.ended) return;
        sound();
        var result = video.play();
        if (result && result.then) {
            result.then(function () {}, function (reason) {
                if (paused || reason.name === 'AbortError') return;
                if (reason.name === 'NotAllowedError') {
                    error('AUTOPLAY_BLOCKED', 'Браузер ожидает разрешение на запуск видео.');
                } else {
                    error('PLAYBACK_ERROR', 'Не удалось запустить WebM-видео: ' + reason.name);
                }
            });
        }
    }
    function progress() {
        var time = video.currentTime;
        if (advancing && !paused && !video.paused && !video.seeking && video.readyState >= 2 && time > previousTime + 0.02) {
            failed = false;
            message.hidden = true;
            resume.hidden = true;
            if (!played) {
                played = true;
                console.log('READY:rutube');
            }
            if (state !== 'playing') report('playing');
        }
        previousTime = time;
    }

    window.ixRutube = {
        volume: function (value) { volume = number(value, 0, 1); sound(); },
        pause: function () {
            target = desiredTime(); targetAt = Date.now(); paused = true;
            advancing = false;
            video.pause();
            if (!failed) report('paused');
        },
        play: function () {
            if (paused) { targetAt = Date.now(); startedAt = Date.now(); }
            paused = false;
            sync(false);
            play();
        },
        sync: function (value) {
            target = number(value, 0, 43200); targetAt = Date.now(); sync(false);
        },
        status: function () {
            return {state: state, ready: ready, played: played, advertising: false, paused: paused,
                time: ready ? video.currentTime : null, duration: ready ? video.duration : null,
                codecs: codecs, source: record ? record.url : null, decodedFrames: video.webkitDecodedFrameCount || 0};
        }
    };

    resume.addEventListener('click', function () { window.ixRutube.play(); });
    video.id = 'player';
    video.preload = 'auto';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    sound();
    video.addEventListener('loadedmetadata', function () {
        if (!isFinite(video.duration) || video.duration <= 0) {
            error('INVALID_MEDIA', 'Видеофайл не содержит корректной длительности.');
            return;
        }
        ready = true;
        sync(true);
        if (paused) { video.pause(); report('paused'); } else play();
    });
    video.addEventListener('loadeddata', function () {
        if (paused && !failed) message.hidden = true;
    });
    video.addEventListener('canplay', function () { sync(false); play(); });
    video.addEventListener('playing', function () {
        if (paused) { video.pause(); return; }
        advancing = true;
        previousTime = video.currentTime;
    });
    video.addEventListener('seeking', function () { previousTime = video.currentTime; });
    video.addEventListener('seeked', function () { previousTime = video.currentTime; });
    video.addEventListener('timeupdate', progress);
    video.addEventListener('waiting', function () {
        advancing = false;
        if (!paused && !failed) report('buffering');
    });
    video.addEventListener('ended', function () { advancing = false; report('ended'); });
    video.addEventListener('error', function () {
        var code = video.error ? video.error.code : 0;
        error(code === 2 ? 'MEDIA_NETWORK' : code === 3 ? 'MEDIA_DECODE' : 'MEDIA_UNSUPPORTED',
            code === 2 ? 'Не удалось загрузить видео с GitHub Releases.' : 'Браузер не смог декодировать WebM VP8/Vorbis.');
    });

    if (!/^[a-f0-9]{32}$/.test(id)) {
        error('INVALID_VIDEO', 'Не указан корректный ID видеозаписи.');
        return;
    }
    if (!codecs.webm) {
        error('WEBM_UNSUPPORTED', 'Этот браузер игры не поддерживает WebM VP8/Vorbis.');
        return;
    }
    document.getElementById('screen').appendChild(video);
    report('loading-catalog');
    var watchdog = window.setInterval(function () {
        if (!played && !failed && !paused && Date.now() - startedAt > 60000) {
            error('PLAYBACK_TIMEOUT', 'Видеопоток не запустился. Проверьте доступность GitHub Pages и Releases.');
        }
    }, 5000);
    window.addEventListener('pagehide', function () {
        window.clearInterval(watchdog);
        paused = true;
        video.pause();
        video.removeAttribute('src');
        video.load();
    });
    window.fetch('catalog.json', {cache: 'no-store'}).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }).then(function (catalog) {
        if (catalog.version !== 1 || !catalog.videos) throw new Error('Invalid catalog');
        var media = catalog.videos[id];
        if (!media) {
            error('MEDIA_NOT_PREPARED', 'Эта кассета ещё не прошла конвертацию на GitHub.');
            return;
        }
        var filename = id + '.vp8-vorbis.' + String(media.sha256).slice(0, 12) + '.webm';
        var url = 'https://github.com/Satan1st/autonomous-tv-player/releases/download/media-webm-v1/' + filename;
        if (!/^[a-f0-9]{64}$/.test(media.sha256) || media.url !== url || media.videoCodec !== 'vp8' || media.audioCodec !== 'vorbis') {
            throw new Error('Invalid media manifest');
        }
        record = media;
        failed = false;
        report('loading-media');
        video.src = media.url;
        video.load();
    }).catch(function (reason) {
        error('CATALOG_UNAVAILABLE', 'Не удалось загрузить каталог видео: ' + reason.message);
    });
}());
