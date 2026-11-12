const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');

(async function () {
    const base = process.env.PLAYER_URL || 'https://satan1st.github.io/autonomous-tv-player/';
    const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {});
    if (process.env.EXPECTED_CHROMIUM_MAJOR) assert.equal(browser.version().split('.')[0], process.env.EXPECTED_CHROMIUM_MAJOR);
    const context = await browser.newContext();
    const sources = JSON.parse(fs.readFileSync('sources.json', 'utf8'));
    const ids = process.env.VIDEO_IDS === 'all' ? Object.keys(sources)
        : process.env.VIDEO_IDS ? process.env.VIDEO_IDS.split(',') : ['f7b6cb8cdec08dfbda31fbcca2281288'];
    const results = [];
    fs.mkdirSync('playback-results', {recursive: true});
    try {
        for (const id of ids) {
            const page = await context.newPage();
            const signals = [], failures = [], transfers = [];
            page.on('console', message => signals.push(message.text()));
            page.on('pageerror', error => failures.push(error.message));
            if (process.env.STOCK_CEF === '1') {
                await page.addInitScript(() => {
                    const original = HTMLCanvasElement.prototype.getContext;
                    HTMLCanvasElement.prototype.getContext = function (type, options) {
                        return type.toLowerCase().includes('webgl') ? null : original.call(this, type, options);
                    };
                    window.nativeCodecAttempts = 0;
                    MediaSource.prototype.addSourceBuffer = function () {
                        window.nativeCodecAttempts++;
                        throw new DOMException('Native H264/AAC is unavailable in this stock-CEF test', 'NotSupportedError');
                    };
                });
            }
            await page.exposeFunction('nativeMediaRequest', async (requestID, url, method, range) => {
                const address = new URL(url);
                assert(address.protocol === 'https:' && /(^|\.)(rutube\.ru|rtbcdn\.ru)$/.test(address.hostname));
                assert(['GET', 'HEAD'].includes(method));
                try {
                    const response = await context.request.fetch(url, {method, headers: range ? {Range: range} : {}, timeout: 35000});
                    const data = method === 'HEAD' ? Buffer.alloc(0) : await response.body();
                    assert(data.length <= 4 * 1024 * 1024);
                    if (process.env.STOCK_CEF === '1' && address.pathname.endsWith('.ts')) {
                        await new Promise(resolve => setTimeout(resolve, 350));
                    }
                    transfers.push({host: address.hostname, bytes: data.length, status: response.status()});
                    const encoded = data.toString('base64');
                    for (let offset = 0; offset < encoded.length; offset += 131072) {
                        await page.evaluate(packet => window.ixStreamReply(packet), {id: requestID, part: encoded.slice(offset, offset + 131072)});
                    }
                    const headers = Object.fromEntries(Object.entries(response.headers()).filter(([name]) =>
                        ['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(name)));
                    await page.evaluate(packet => window.ixStreamReply(packet), {id: requestID, status: response.status(), headers});
                    await response.dispose();
                } catch (error) {
                    failures.push(error.message);
                    await page.evaluate(packet => window.ixStreamReply(packet), {id: requestID, status: 502}).catch(() => {});
                }
            });
            await page.addInitScript(() => {
                window.ixStream = {request: (...args) => { window.nativeMediaRequest(...args); }};
                window.ixStreamReady = true;
                const initialTime = Number(new URLSearchParams(location.hash.slice(1)).get('t'));
                const started = Date.now();
                window.gameSyncTimer = setInterval(() => {
                    if (window.ixRutube) window.ixRutube.sync(initialTime + (Date.now() - started) / 1000);
                }, 300);
            });
            try {
                await page.goto(base + '?stream-check=' + Date.now() + '#v=' + id + '&t=60&volume=0&debug=1');
                await page.waitForFunction(() => window.AVPlayer && AVPlayer.audioContext || window.ixRutube?.status().state === 'error', undefined, {timeout: 60000});
                assert.notEqual(await page.evaluate(() => window.ixRutube.status().state), 'error', 'stream initialization failed');
                if (await page.evaluate(() => AVPlayer.audioContext.state === 'suspended')) {
                    await page.locator('#resume').click({timeout: 10000});
                }
                await page.waitForFunction(() => window.ixRutube.status().played && !window.ixRutube.status().busy, undefined, {timeout: 90000});
                const first = await page.evaluate(() => window.ixRutube.status());
                await page.waitForFunction(start => {
                    const status = window.ixRutube.status();
                    return status.time > start.time + 3 && status.videoFrames > start.videoFrames + 20;
                }, first, {timeout: 30000});
                const startup = await page.evaluate(() => {
                    clearInterval(window.gameSyncTimer);
                    return window.ixRutube.status();
                });
                assert(startup.seekCount <= 2, '300 ms game sync must not continuously restart startup seeking');
                await page.evaluate(() => window.ixRutube.pause());
                await page.waitForFunction(() => !window.ixRutube.status().busy && window.ixRutube.status().paused);
                const initial = await page.evaluate(() => window.ixRutube.status());
                assert(initial.videoFrames > 0 && initial.audioFrames > 0, 'both tracks must be software-decoded and rendered');
                const destination = initial.duration * 0.7;
                await page.evaluate(time => window.ixRutube.sync(time), destination);
                await page.waitForFunction(time => !window.ixRutube.status().busy && Math.abs(window.ixRutube.status().time - time) < 1,
                    destination, {timeout: 60000});
                await page.evaluate(() => window.ixRutube.play());
                await page.waitForFunction(time => window.ixRutube.status().time > time + 1, destination, {timeout: 60000});
                await page.screenshot({path: 'playback-results/' + id + '.png'});
                const status = await page.evaluate(() => window.ixRutube.status());
                assert.equal(status.renderer, 'canvas2d');
                assert.equal(status.nativeMedia, false);
                if (process.env.STOCK_CEF === '1') {
                    const capabilities = await page.evaluate(() => ({webgl: window.ixCanvasVideo.capabilities.webgl, attempts: window.nativeCodecAttempts}));
                    assert.equal(capabilities.webgl, false);
                    assert.equal(capabilities.attempts, 0, 'native codecs must never be selected');
                }
                assert.equal(signals.filter(line => line === 'READY:rutube').length, 1);
                const bytes = transfers.reduce((sum, transfer) => sum + transfer.bytes, 0);
                assert(bytes < 20 * 1024 * 1024, 'playback must stream bounded fragments rather than an entire movie');
                results.push({id, title: sources[id].title, browser: browser.version(), gameSyncIntervalMs: 300,
                    startupSeekCount: startup.seekCount, steadyVideoFrames: startup.videoFrames - first.videoFrames,
                    status, bytes, requests: transfers.length});
                console.log(JSON.stringify(results.at(-1)));
            } catch (error) {
                console.error(JSON.stringify({id, failures, signals: signals.slice(-50), transfers, state: await page.evaluate(() => ({
                    status: window.ixRutube && window.ixRutube.status(), message: document.body.innerText
                })).catch(() => null)}));
                throw error;
            } finally { await page.close(); }
        }
    } finally {
        fs.writeFileSync('playback-results/results.json', JSON.stringify(results, null, 2));
        await browser.close();
    }
}()).catch(error => { console.error(error); process.exitCode = 1; });
