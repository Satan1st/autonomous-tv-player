(function () {
    'use strict';
    window.CHEAP_DISABLE_THREAD = true;
    var original = window.fetch.bind(window);
    var requests = {}, sequence = 0;

    function mediaURL(address) {
        var url = new URL(address, window.location.href);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && /(^|\.)(rutube\.ru|rtbcdn\.ru)$/.test(url.hostname);
    }
    function finish(id, error, response) {
        var request = requests[id];
        if (!request) return;
        delete requests[id];
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
            finish(packet.id, null, response);
        } catch (error) { finish(packet.id, error); }
    };
    window.fetch = function (address, options) {
        var url = typeof address === 'string' ? address : address.url;
        if (!mediaURL(url) || !window.ixStream || typeof window.ixStream.request !== 'function') {
            return original(address, options);
        }
        options = options || {};
        var method = (options.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') return Promise.reject(new TypeError('Read-only media transport'));
        var headers = new Headers(options.headers || {});
        return new Promise(function (resolve, reject) {
            var id = ++sequence;
            var request = requests[id] = {url: url, method: method, parts: [], resolve: resolve, reject: reject, signal: options.signal};
            request.abort = function () { finish(id, new DOMException('Media request cancelled', 'AbortError')); };
            request.timeout = window.setTimeout(function () { finish(id, new Error('Media request timed out')); }, 45000);
            if (request.signal) {
                if (request.signal.aborted) { request.abort(); return; }
                request.signal.addEventListener('abort', request.abort);
            }
            try { window.ixStream.request(id, url, method, headers.get('Range') || ''); }
            catch (error) { finish(id, error); }
        });
    };
    window.addEventListener('pagehide', function () {
        Object.keys(requests).forEach(function (id) { requests[id].abort(); });
    });
}());
