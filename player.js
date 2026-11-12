(function () {
    'use strict';
    var params = new URLSearchParams(window.location.hash.slice(1));
    var id = params.get('v') || '';
    var origin = 'https://rutube.ru';
    var message = document.getElementById('message');
    var diagnostics = document.getElementById('diagnostics');
    var probe = document.createElement('video');
    var codecs = {
        h264: probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '',
        aac: probe.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '',
        mse: !!window.MediaSource && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
    };
    var ready = false, advertising = false, played = false, failed = false;
    var paused = params.get('paused') === '1';
    var target = number(params.get('t'), 0, 43200);
    var volume = number(params.get('volume'), 0, 1);
    var targetAt = Date.now(), current = null, state = 'loading';
    var frame;
    diagnostics.hidden = params.get('debug') !== '1';

    function number(value, fallback, maximum) {
        value = Number(value);
        return isFinite(value) ? Math.max(0, Math.min(maximum, value)) : fallback;
    }
    function report(next, detail) {
        state = next;
        diagnostics.textContent = next + (detail ? ': ' + detail : '');
        console.log('IXTV:' + JSON.stringify({version: 1, state: next, detail: detail || '', codecs: codecs}));
    }
    function error(code, text) {
        failed = true;
        message.textContent = text + '\nКод: ' + code;
        message.hidden = false;
        report('error', code);
    }
    function command(type, data) {
        if (ready && frame) frame.contentWindow.postMessage(JSON.stringify({type: 'player:' + type, data: data || {}}), origin);
    }
    function desiredTime() {
        return target + (paused ? 0 : Math.max(0, Date.now() - targetAt) / 1000);
    }
    function sound() {
        command('setVolume', {volume: volume});
        command(volume > 0 ? 'unMute' : 'mute');
    }
    function sync() {
        var time = desiredTime();
        if (played && !advertising && current !== null && Math.abs(current - time) > 5) {
            command('setCurrentTime', {time: time});
        }
    }
    function playbackStarted() {
        if (advertising) return;
        failed = false;
        message.hidden = true;
        if (!played) {
            played = true;
            console.log('READY:rutube');
            sound();
        }
        var next = paused ? 'paused' : 'playing';
        if (state !== next) report(next);
        sync();
    }

    window.ixRutube = {
        volume: function (value) { volume = number(value, 0, 1); sound(); },
        pause: function () {
            target = desiredTime(); targetAt = Date.now(); paused = true;
            command('pause');
            if (played) report('paused');
        },
        play: function () {
            if (paused) targetAt = Date.now();
            paused = false; command('play');
        },
        sync: function (value) { target = number(value, 0, 43200); targetAt = Date.now(); sync(); },
        status: function () { return {state: state, ready: ready, played: played, advertising: advertising, paused: paused, time: current, codecs: codecs}; }
    };

    window.addEventListener('message', function (event) {
        if (!frame || event.origin !== origin || event.source !== frame.contentWindow) return;
        var packet;
        try { packet = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch (_) { return; }
        if (!packet || !packet.type) return;
        var data = packet.data || {};
        if (packet.type === 'player:ready') {
            ready = true;
            sound(); command(paused ? 'pause' : 'play');
            report('player-ready');
        } else if (packet.type === 'player:currentTime') {
            if (isFinite(Number(data.time))) {
                current = Number(data.time);
                if (!paused && (!played || failed || state !== 'playing')) playbackStarted();
            }
        } else if (packet.type === 'player:changeState') {
            if (data.state === 'playing') playbackStarted();
        } else if (packet.type === 'player:adStart') {
            advertising = true;
        } else if (packet.type === 'player:adEnd' || (packet.type === 'player:rollState' && data.state === 'complete')) {
            advertising = false; sound(); sync();
        } else if (packet.type === 'player:error') {
            if (!codecs.h264 || !codecs.aac || !codecs.mse) {
                error('CODEC_UNSUPPORTED', 'Браузер игры не поддерживает кодеки H.264/AAC этого видеопотока. Сообщите администратору код ошибки.');
            } else {
                error(String(data.code || 'RUTUBE_ERROR'), String(data.text || 'Rutube не смог загрузить видеопоток.'));
            }
        }
    });

    if (!/^[a-f0-9]{32}$/.test(id)) {
        error('INVALID_VIDEO', 'Не указан корректный ID видеозаписи.');
        return;
    }
    frame = document.createElement('iframe');
    frame.id = 'player';
    frame.allow = 'autoplay; encrypted-media; fullscreen';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = origin + '/play/embed/' + id + '?autoplay=true&autostartmute=true&t=' + target
        + '&referer=' + encodeURIComponent(window.location.origin + window.location.pathname);
    document.getElementById('screen').appendChild(frame);
    report('loading');
    window.setTimeout(function () {
        if (played || failed || paused) return;
        if (!codecs.h264 || !codecs.aac || !codecs.mse) {
            error('CODEC_UNSUPPORTED', 'Браузер игры не поддерживает H.264/AAC. HTTPS-прослойка не меняет поддержку кодеков.');
        } else {
            error('PLAYBACK_TIMEOUT', 'Видеопоток не запустился. Проверьте доступность Rutube/CDN и сообщите администратору код ошибки.');
        }
    }, 45000);
}());
