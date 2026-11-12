const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('player.js', 'utf8');
const id = 'f7b6cb8cdec08dfbda31fbcca2281288';

async function fixture(hash = '#v=' + id + '&t=42', nativeReady = true, syncDuringSeek = false) {
    const logs = [], events = {}, commands = [], elements = {message: {}, diagnostics: {}, resume: {addEventListener() {}}, screen: {}};
    let clock = 1000, timer, resolveOptions;
    const options = new Promise(resolve => { resolveOptions = resolve; });
    const stats = {videoFrameRenderCount: 0, audioFrameRenderCount: 0, videocodec: 'h264', audiocodec: 'aac'};
    class Player {
        static setLogLevel() {}
        constructor(config) { this.config = config; Player.instance = this; }
        on(name, callback) { events[name] = callback; }
        setVolume(value) { this.volume = value; }
        async load(url) { this.url = url; }
        async play() { commands.push('play'); }
        async pause() { commands.push('pause'); }
        async seek(time) {
            commands.push(Number(time)); events.time(time);
            if (syncDuringSeek) {
                if (commands.filter(command => typeof command === 'number').length > 3) throw new Error('Repeated startup seek');
                clock += 350;
                context.window.ixRutube.sync(Number(time) / 1000 + 0.35);
                await Promise.resolve();
            }
        }
        getStats() { return stats; }
        async destroy() { commands.push('destroy'); }
    }
    const context = {AVPlayer: Player, URL, URLSearchParams, BigInt, Date: {now: () => clock},
        console: {log: line => logs.push(line)}, document: {getElementById: key => elements[key]},
        window: {AVPlayer: Player, WebAssembly: {}, ixCanvasVideo: {installed: true, renderer: 'canvas2d'}, ixStreamReady: nativeReady, location: {hash}, addEventListener() {},
            setInterval: callback => { timer = callback; }, clearInterval() {},
            fetch: async url => url.includes('/api/') ? {ok: true, json: () => options}
                : {ok: true, text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=426x240\nhttps://river.rutube.ru/movie.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nhttps://river.rutube.ru/hd.m3u8'} }};
    vm.runInNewContext(source, context);
    async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
    return {logs, commands, elements, bridge: context.window.ixRutube, flush, get player() { return Player.instance; },
        connect() { context.window.ixStreamReady = true; context.window.ixStreamStart(); },
        tick(milliseconds) { clock += milliseconds; },
        frame(time) { stats.videoFrameRenderCount += 2; stats.audioFrameRenderCount++; events.time(BigInt(time * 1000)); timer(); },
        async load() { resolveOptions({acl_access: {allowed: true}, duration: 5500000, video_balancer: {m3u8: 'https://bl.rutube.ru/master.m3u8'}}); await flush(); }};
}

(async function () {
    let test = await fixture();
    test.bridge.volume(0.25); test.bridge.sync(75); test.bridge.pause(); test.tick(10000);
    await test.load();
    assert.equal(test.player.url, 'https://river.rutube.ru/movie.m3u8');
    assert.equal(test.player.config.enableWebCodecs, false);
    assert.equal(test.player.config.checkUseMSE(), false);
    assert(test.commands.includes(75000));
    assert.equal(test.commands.at(-1), 'pause');
    assert.equal(test.player.volume, 0.25);
    assert(!test.logs.includes('READY:rutube'));
    test.bridge.play(); await test.flush(); test.frame(75); test.frame(76);
    assert.equal(test.logs.filter(x => x === 'READY:rutube').length, 1);
    test.bridge.sync(120); await test.flush();
    assert(test.commands.includes(120000));
    test.bridge.volume(-3); assert.equal(test.player.volume, 0);
    test.bridge.pause(); await test.flush(); test.tick(10000); test.bridge.play(); await test.flush();
    assert.equal(test.bridge.status().time, 120);
    test = await fixture(); test.tick(10000); await test.load();
    assert(test.commands.includes(52000));
    test = await fixture('#v=invalid');
    assert(test.elements.message.textContent.includes('INVALID_VIDEO'));
    test = await fixture(undefined, false); await test.load();
    assert.equal(test.bridge.status().state, 'waiting-game-bridge');
    assert(!test.player);
    test.connect(); test.connect(); await test.flush();
    assert.equal(test.player.url, 'https://river.rutube.ru/movie.m3u8');
    assert.equal(test.commands.filter(command => command === 'play').length, 1);
    test = await fixture(undefined, true, true); await test.load();
    assert.equal(test.commands.filter(command => typeof command === 'number').length, 1,
        'periodic game sync during the first seek must not restart that seek until READY');
    assert.equal(test.bridge.status().busy, false);
    test.frame(43); test.frame(44);
    assert(test.bridge.status().played);

    const canvasWindow = {};
    vm.runInNewContext(fs.readFileSync('canvas-renderer.js', 'utf8'), {window: canvasWindow});
    const rgba = new Uint8ClampedArray(3 * 3 * 4);
    canvasWindow.ixCanvasVideo.convert420(Uint8Array.from([16, 235, 16, 99, 235, 16, 235, 99, 16, 235, 16, 99]),
        Uint8Array.from([128, 128, 128, 128]), Uint8Array.from([128, 128, 128, 128]), [4, 2, 2], 3, 3, false, true, rgba);
    assert.deepEqual([...rgba.slice(0, 12)], [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    assert.deepEqual([...rgba.slice(24, 28)], [0, 0, 0, 255]);
    canvasWindow.ixCanvasVideo.convert420(Uint8Array.from([0]), Uint8Array.from([128]), Uint8Array.from([128]), [1, 1, 1], 1, 1, true, false, rgba);
    assert.deepEqual([...rgba.slice(0, 4)], [0, 0, 0, 255]);

    const handlers = {}, requests = [], window = {fetch: async () => 'ordinary-fetch', location: {href: 'https://example.com/'},
        ixStream: {request: (...args) => requests.push(args)}, atob, setTimeout, clearTimeout, addEventListener() {}};
    vm.runInNewContext(fs.readFileSync('stream-fetch.js', 'utf8'), {window, URL, Headers, Response, Uint8Array, Promise, DOMException});
    const response = window.fetch('https://river.rutube.ru/segment.ts');
    const request = requests.pop();
    window.ixStreamReply({id: request[0], part: Buffer.from([0, 255, 128]).toString('base64')});
    window.ixStreamReply({id: request[0], status: 200, headers: {'content-type': 'video/mp2t'}});
    assert.deepEqual(Buffer.from(await (await response).arrayBuffer()), Buffer.from([0, 255, 128]));
    assert.equal(await window.fetch('https://rutube.ru.evil.example/segment.ts'), 'ordinary-fetch');
    const controller = new AbortController();
    const cancelled = window.fetch('https://rutube.ru/api/video/test', {signal: controller.signal});
    controller.abort(); await assert.rejects(cancelled, {name: 'AbortError'});
    console.log('Streaming player: software decode, transport bytes/abort, source selection, late join and controls passed');
}()).catch(error => { console.error(error); process.exitCode = 1; });
