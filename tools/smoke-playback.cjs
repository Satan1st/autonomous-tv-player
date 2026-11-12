const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');

(async function () {
    const base = process.env.PLAYER_URL || 'https://satan1st.github.io/autonomous-tv-player/';
    const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {});
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
            await page.exposeFunction('nativeMediaRequest', async (requestID, url, method, range) => {
                const address = new URL(url);
                assert(address.protocol === 'https:' && /(^|\.)(rutube\.ru|rtbcdn\.ru)$/.test(address.hostname));
                assert(['GET', 'HEAD'].includes(method));
                try {
                    const response = await context.request.fetch(url, {method, headers: range ? {Range: range} : {}, timeout: 35000});
                    const data = method === 'HEAD' ? Buffer.alloc(0) : await response.body();
                    assert(data.length <= 4 * 1024 * 1024);
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
            });
            try {
                await page.goto(base + '?stream-check=' + Date.now() + '#v=' + id + '&t=60&volume=0&debug=1');
                await page.waitForFunction(() => window.AVPlayer && AVPlayer.audioContext || window.ixRutube?.status().state === 'error', undefined, {timeout: 60000});
                assert.notEqual(await page.evaluate(() => window.ixRutube.status().state), 'error', 'stream initialization failed');
                if (await page.evaluate(() => AVPlayer.audioContext.state === 'suspended')) {
                    await page.locator('#resume').click({timeout: 10000});
                }
                await page.waitForFunction(() => window.ixRutube.status().played && window.ixRutube.status().time > 63, undefined, {timeout: 90000});
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
                assert.equal(signals.filter(line => line === 'READY:rutube').length, 1);
                const bytes = transfers.reduce((sum, transfer) => sum + transfer.bytes, 0);
                assert(bytes < 20 * 1024 * 1024, 'playback must stream bounded fragments rather than an entire movie');
                results.push({id, title: sources[id].title, browser: browser.version(), status, bytes, requests: transfers.length});
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
