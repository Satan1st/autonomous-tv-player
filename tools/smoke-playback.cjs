const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');

(async function () {
    const base = process.env.PLAYER_URL || 'https://satan1st.github.io/autonomous-tv-player/';
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const results = [];
    fs.mkdirSync('playback-results', {recursive: true});
    try {
        const response = await context.request.get(base + 'catalog.json?check=' + Date.now());
        assert.equal(response.status(), 200);
        const catalog = await response.json();
        assert(Object.keys(catalog.videos).length > 0, 'catalog must contain prepared media');
        for (const [id, media] of Object.entries(catalog.videos)) {
            const page = await context.newPage();
            const failures = [];
            const signals = [];
            page.on('requestfailed', request => failures.push({url: request.url(), error: request.failure()}));
            page.on('console', message => signals.push(message.text()));
            try {
                const range = await context.request.get(media.url, {headers: {Range: 'bytes=0-1023'}});
                assert.equal(range.status(), 206, 'media delivery must support seeking');
                assert.equal((await range.body()).length, 1024);
                assert.equal(range.headers()['content-range'], 'bytes 0-1023/' + media.bytes);
                const start = media.duration > 120 ? 60 : 0;
                await page.goto(base + '?check=' + Date.now() + '#v=' + id + '&t=' + start + '&volume=0&debug=1');
                await page.waitForFunction(minimum => {
                    const video = document.querySelector('video');
                    return window.ixRutube && window.ixRutube.status().played && video.currentTime > minimum + 3;
                }, start, {timeout: 90000});
                const initial = await page.evaluate(() => {
                    const video = document.querySelector('video');
                    window.ixRutube.pause();
                    return {status: window.ixRutube.status(), audioBytes: video.webkitAudioDecodedByteCount};
                });
                assert(initial.status.decodedFrames > 0, 'video frames must be decoded');
                assert(initial.audioBytes > 0, 'the Vorbis audio track must be decoded');
                await page.evaluate(() => new Promise(resolve => {
                    const video = document.querySelector('video');
                    const position = video.currentTime;
                    let frames = 0;
                    function sample() {
                        if (!video.paused || video.currentTime !== position) throw new Error('Pause did not hold');
                        if (++frames === 12) resolve(); else requestAnimationFrame(sample);
                    }
                    requestAnimationFrame(sample);
                }));
                const destination = media.duration * 0.7;
                await page.evaluate(time => window.ixRutube.sync(time), destination);
                await page.waitForFunction(time => {
                    const video = document.querySelector('video');
                    return !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 1;
                }, destination, {timeout: 60000});
                await page.evaluate(() => window.ixRutube.play());
                await page.waitForFunction(time => document.querySelector('video').currentTime > time + 0.3,
                    destination, {timeout: 30000});
                await page.screenshot({path: 'playback-results/' + id + '.png'});
                assert.equal(signals.filter(value => value === 'READY:rutube').length, 1);
                const status = await page.evaluate(() => window.ixRutube.status());
                results.push({id, title: media.title, range: range.status(), contentType: range.headers()['content-type'],
                    duration: media.duration, audioBytes: initial.audioBytes, status});
                console.log(JSON.stringify(results[results.length - 1]));
            } catch (error) {
                console.error(JSON.stringify({id, failures, signals, page: await page.evaluate(() => ({
                    state: window.ixRutube && window.ixRutube.status(), message: document.body.innerText
                })).catch(() => null)}));
                throw error;
            } finally {
                await page.close();
            }
        }
    } finally {
        fs.writeFileSync('playback-results/results.json', JSON.stringify(results, null, 2));
        await browser.close();
    }
}()).catch(error => { console.error(error); process.exitCode = 1; });
