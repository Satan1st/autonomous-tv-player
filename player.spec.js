const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'player.js'), 'utf8');

function fixture(codecs = true, hash = '#v=f7b6cb8cdec08dfbda31fbcca2281288&t=42') {
    const commands = [], logs = [], elements = {message: {}, diagnostics: {}, screen: {appendChild(x) { elements.player = x; }}};
    let receiver, timeout, clock = 1000;
    const document = {getElementById: id => elements[id], createElement: name => name === 'video'
        ? {canPlayType: () => codecs ? 'probably' : ''}
        : {contentWindow: {postMessage: (data, origin) => commands.push({data: JSON.parse(data), origin})}}};
    const context = {document, URLSearchParams, Date: {now: () => clock}, console: {log: x => logs.push(x)},
        MediaSource: {isTypeSupported: () => codecs}, window: {
            location: {hash, origin: 'https://example.github.io', pathname: '/player/'},
            MediaSource: {}, addEventListener: (_, callback) => { receiver = callback; },
            setTimeout: callback => { timeout = callback; }
        }};
    vm.runInNewContext(source, context);
    return {elements, commands, logs, bridge: context.window.ixRutube, timeout: () => timeout(),
        tick: value => { clock += value; }, event(type, data = {}, origin = 'https://rutube.ru', from = elements.player.contentWindow) {
            receiver({origin, source: from, data: JSON.stringify({type: 'player:' + type, data})});
        }};
}

let test = fixture();
assert(test.elements.player.src.includes('referer=https%3A%2F%2Fexample.github.io%2Fplayer%2F'));
test.bridge.volume(0.25); test.bridge.sync(75); test.bridge.pause();
assert.equal(test.commands.length, 0);
test.event('ready', {}, 'https://example.com');
assert.equal(test.commands.length, 0);
test.event('ready');
assert.equal(test.bridge.status().played, false);
assert(!test.logs.includes('READY:rutube'));
assert(!test.commands.some(x => x.data.type === 'player:setCurrentTime'));
assert(test.commands.some(x => x.data.type === 'player:pause'));
test.bridge.play(); test.event('currentTime', {time: 30});
assert(test.logs.includes('READY:rutube'));
assert.equal(test.commands.at(-1).data.data.time, 75);
test.event('adStart');
test.tick(10000); test.bridge.sync(120);
const before = test.commands.length;
test.event('currentTime', {time: 2});
assert.equal(test.commands.length, before);
test.event('adEnd');
assert.equal(test.commands.at(-1).data.data.time, 120);
test.bridge.volume(-2);
assert.equal(test.commands.at(-1).data.type, 'player:mute');
test.timeout();
assert.equal(test.bridge.status().state, 'playing');

test = fixture(false);
test.event('error', {code: 'INTEXCP_PRMCDN_RB_WEB'});
assert(test.elements.message.textContent.includes('CODEC_UNSUPPORTED'));
test = fixture(); test.timeout();
assert(test.elements.message.textContent.includes('PLAYBACK_TIMEOUT'));
test = fixture(true, '#v=invalid');
assert(!test.elements.player);
assert(test.elements.message.textContent.includes('INVALID_VIDEO'));
console.log('TV page: origin, readiness, deferred seek, pause, volume, ads, invalid IDs and error diagnostics passed');
