(function () {
    'use strict';
    window.CHEAP_DISABLE_THREAD = true;
    var original = window.fetch.bind(window);
    var requests = {}, sequence = 0;
    var status = {pending: 0, retries: 0, bytes: 0, lastProgress: Date.now(), lastError: null, lastFailure: null};
    window.ixStreamStatus = function () {
        return {pending: status.pending, retries: status.retries, bytes: status.bytes,
            lastProgress: status.lastProgress, lastError: status.lastError, lastFailure: status.lastFailure};
    };

    function mediaURL(address) {
        var url = new URL(address, window.location.href);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && /(^|\.)(rutube\.ru|rtbcdn\.ru)$/.test(url.hostname);
    }
    function failure(request, reason, code) {
        var url = new URL(request.url);
        var detail = String(reason && reason.message || reason);
        status.lastError = url.hostname + ': ' + detail;
        status.lastFailure = {host: url.hostname, resource: url.pathname.indexOf('/api/') === 0 ? 'api'
            : /\.m3u8$/i.test(url.pathname) ? 'playlist' : 'fragment', status: code || 0, reason: detail, at: Date.now()};
    }
    function finish(id, error, response) {
        var request = requests[id];
        if (!request) return;
        if (error && error.name !== 'AbortError') failure(request, error);
        delete requests[id];
        status.pending--;
        window.clearTimeout(request.timeout);
        if (request.signal) request.signal.removeEventListener('abort', request.abort);
        if (error) request.reject(error); else request.resolve(response);
    }
    window.ixStreamReply = function (packet) {
        var request = requests[packet.id];
        if (!request) return;
        if (typeof packet.part === 'string') {
            request.parts.push(packet.part);
            return;
        }
        try {
            var raw = window.atob(request.parts.join(''));
            var bytes = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            var response = new Response(request.method === 'HEAD' ? null : bytes, {
                status: packet.status, headers: packet.headers || {}
            });
            Object.defineProperty(response, 'url', {value: request.url});
            if (response.ok) {
                status.bytes += bytes.length;
                status.lastProgress = Date.now();
            } else failure(request, 'HTTP ' + packet.status + (packet.error ? ' (' + packet.error + ')' : ''), packet.status);
            finish(packet.id, null, response);
        } catch (error) { finish(packet.id, error); }
    };
    function attempt(url, method, headers, signal) {
        return new Promise(function (resolve, reject) {
            var id = ++sequence;
            var request = requests[id] = {url: url, method: method, parts: [], resolve: resolve, reject: reject, signal: signal};
            status.pending++;
            function cancel() {
                if (window.ixStream && typeof window.ixStream.cancel === 'function') window.ixStream.cancel(id);
            }
            request.abort = function () { cancel(); finish(id, new DOMException('Media request cancelled', 'AbortError')); };
            request.timeout = window.setTimeout(function () {
                cancel();
                finish(id, new Error('Media request timed out'));
            }, 45000);
            if (signal) {
                if (signal.aborted) { request.abort(); return; }
                signal.addEventListener('abort', request.abort);
            }
            try { window.ixStream.request(id, url, method, headers.get('Range') || ''); }
            catch (error) { finish(id, error); }
        });
    }
    function wait(delay, signal) {
        return new Promise(function (resolve, reject) {
            function done() { if (signal) signal.removeEventListener('abort', abort); resolve(); }
            var timer = window.setTimeout(done, delay);
            function abort() {
                window.clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', abort);
                reject(new DOMException('Media request cancelled', 'AbortError'));
            }
            if (signal) {
                if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
            }
        });
    }
    window.fetch = async function (address, options) {
        var url = typeof address === 'string' ? address : address.url;
        if (!mediaURL(url) || !window.ixStream || typeof window.ixStream.request !== 'function') {
            return original(address, options);
        }
        options = options || {};
        var method = (options.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') return Promise.reject(new TypeError('Read-only media transport'));
        var headers = new Headers(options.headers || {});
        for (var retry = 0; retry < 3; retry++) {
            try {
                var response = await attempt(url, method, headers, options.signal);
                if (retry === 2 || [408, 425, 429, 500, 502, 503, 504].indexOf(response.status) === -1) return response;
            } catch (error) {
                if (error.name === 'AbortError' || retry === 2) throw error;
            }
            status.retries++;
            await wait(500 * (retry + 1), options.signal);
        }
    };
    window.addEventListener('pagehide', function () {
        Object.keys(requests).forEach(function (id) { requests[id].abort(); });
    });
}());
