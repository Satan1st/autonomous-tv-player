const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'player.js'), 'utf8');
const id = 'f7b6cb8cdec08dfbda31fbcca2281288';
const media = {sha256: 'a'.repeat(64), videoCodec: 'vp8', audioCodec: 'vorbis',
    url: 'https://github.com/Satan1st/autonomous-tv-player/releases/download/media-webm-v1/' + id + '.vp8-vorbis.' + 'a'.repeat(12) + '.webm'};

async function fixture(options = {}) {
    const logs = [], listeners = {}, pageEvents = {};
    let clock = 1000, watchdog, resolveCatalog;
    const elements = {message: {}, diagnostics: {}, resume: {addEventListener() {}},
        screen: {appendChild(x) { elements.player = x; }}};
    const video = {canPlayType: () => options.codecs === false ? '' : 'probably', currentTime: 0,
        duration: 5500, paused: true, readyState: 0, seeking: false,
        addEventListener: (name, callback) => { listeners[name] = callback; }, setAttribute() {}, removeAttribute() {}, load() {},
        pause() { this.paused = true; },
        play() { this.paused = false; return options.blocked ? Promise.reject({name: 'NotAllowedError'}) : Promise.resolve(); }};
    const catalogPromise = new Promise(resolve => { resolveCatalog = resolve; });
    const context = {document: {getElementById: key => elements[key], createElement: () => video},
        URLSearchParams, Date: {now: () => clock}, console: {log: x => logs.push(x)}, window: {
            location: {hash: options.hash || '#v=' + id + '&t=42'},
            fetch: () => catalogPromise, addEventListener: (name, callback) => { pageEvents[name] = callback; },
            setInterval: callback => { watchdog = callback; }, clearInterval: () => { watchdog = null; }
        }};
    vm.runInNewContext(source, context);
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    return {video, elements, logs, bridge: context.window.ixRutube, flush,
        tick: value => { clock += value; }, timeout: () => watchdog(),
        event: name => listeners[name](), hide: () => pageEvents.pagehide(),
        async catalog(value = {version: 1, videos: {[id]: media}}) {
            resolveCatalog({ok: true, json: () => Promise.resolve(value)}); await flush();
        }};
}

(async function () {
    let test = await fixture();
    test.bridge.volume(0.25); test.bridge.sync(75); test.bridge.pause(); test.tick(10000);
    await test.catalog();
    assert.equal(test.video.src, media.url);
    test.video.readyState = 1; test.event('loadedmetadata');
    assert.equal(test.video.currentTime, 75);
    assert.equal(test.video.paused, true);
    assert.equal(test.video.volume, 0.25);
    assert(!test.logs.includes('READY:rutube'));
    test.video.readyState = 4; test.event('loadeddata');
    assert.equal(test.elements.message.hidden, true);
    test.bridge.play(); test.event('playing'); test.event('timeupdate');
    assert(!test.logs.includes('READY:rutube'));
    test.video.currentTime += 0.2; test.event('timeupdate');
    assert.equal(test.logs.filter(x => x === 'READY:rutube').length, 1);
    test.tick(3000); test.bridge.sync(120);
    assert.equal(test.video.currentTime, 120);
    test.event('seeked'); test.video.currentTime += 0.2; test.event('timeupdate');
    assert.equal(test.logs.filter(x => x === 'READY:rutube').length, 1);
    test.bridge.volume(-2); assert.equal(test.video.muted, true);
    test.bridge.pause(); test.tick(10000); test.bridge.play();
    assert.equal(test.video.currentTime, 120.2);
    test.event('waiting'); assert.equal(test.bridge.status().state, 'buffering');
    test.event('playing'); test.video.currentTime += 0.3; test.event('timeupdate');
    assert.equal(test.bridge.status().state, 'playing');
    test.timeout(); assert.equal(test.bridge.status().state, 'playing');
    test.hide(); assert.equal(test.video.paused, true);

    test = await fixture(); test.tick(10000); await test.catalog();
    test.video.readyState = 4; test.event('loadedmetadata');
    assert.equal(test.video.currentTime, 52, 'late join includes page-loading time');
    test.video.error = {code: 2}; test.event('error');
    assert(test.elements.message.textContent.includes('MEDIA_NETWORK'));

    test = await fixture({blocked: true}); await test.catalog();
    test.event('loadedmetadata'); await test.flush();
    assert(test.elements.message.textContent.includes('AUTOPLAY_BLOCKED'));
    assert.equal(test.elements.resume.hidden, false);
    assert(!test.logs.includes('READY:rutube'));

    test = await fixture(); await test.catalog({version: 1, videos: {}});
    assert(test.elements.message.textContent.includes('MEDIA_NOT_PREPARED'));
    test = await fixture(); await test.catalog({version: 1, videos: {[id]: {...media, url: 'https://example.com/fake.webm'}}});
    assert(test.elements.message.textContent.includes('CATALOG_UNAVAILABLE'));
    assert(!test.video.src);
    test = await fixture({codecs: false});
    assert(test.elements.message.textContent.includes('WEBM_UNSUPPORTED'));
    test = await fixture({hash: '#v=invalid'});
    assert(!test.elements.player);
    assert(test.elements.message.textContent.includes('INVALID_VIDEO'));
    test = await fixture(); test.tick(61000); test.timeout();
    assert(test.elements.message.textContent.includes('PLAYBACK_TIMEOUT'));
    test = await fixture({hash: '#v=' + id + '&paused=1'}); test.tick(61000); test.timeout();
    assert.equal(test.bridge.status().state, 'loading-catalog');
    console.log('WebM player: verified catalog, actual playback readiness, late join, pause/resume, volume, buffering and errors passed');
}()).catch(error => { console.error(error); process.exitCode = 1; });
