# AUTONOMOUS streaming TV player

GitHub Pages serves the player code and a software H.264/AAC decoder. Films remain on Rutube. The page reads short HLS fragments, decodes them with WebAssembly and renders video/audio inside Garry's Mod's browser. Media is held in a bounded in-memory streaming buffer; no complete film is downloaded, converted ahead of time, uploaded, or stored on GitHub or the game server.

Player: https://satan1st.github.io/autonomous-tv-player/

## In-game integration

The `ix_rutube` service, version **6**, opens `/#v=<Rutube ID>&t=0&volume=0`, with a fresh document query for each playback session. The existing cassette IDs are preserved. `window.ixRutube.play()`, `.pause()`, `.volume(0..1)`, `.sync(seconds)` and `.status()` provide the playback interface.

Rutube does not grant cross-origin JavaScript access to its API/CDN from this Pages origin. The service provides a restricted, read-only **client-side** `DHTML:AddFunction` HTTP transport for HTTPS Rutube/CDN URLs. Fragments travel directly from Rutube to that player's GMod process and into the decoder's RAM. The game server handles only ordinary cassette metadata and shared playback state.

This transport is required: opening the page in an ordinary standalone browser does not provide the native game bridge. No client codec package or browser patch is installed.

## Decoder

Unmodified libmedia `v1.3.1-6-g4bd0fdae` is vendored under `vendor/libmedia`, with baseline H.264/AAC WASM modules and LGPL notices/source references. `canvas-renderer.js` adapts that pinned build to software YUV420-to-RGBA conversion and ordinary Canvas 2D. It explicitly prevents the library's automatic MSE fallback when WebGL is unavailable. WebGL, WebCodecs, MSE, WebGPU, SIMD and shared-memory worker decoding are not required. Initial rendition selection targets 240p, or the lowest available rendition when the source offers nothing at or below 240p, to limit the software-decoding cost on game clients.

`READY:rutube` is emitted after rendered video time advances. `status()` includes software-rendered video/audio frame counts and transport retries, bytes and the last native HTTP error. Add `debug=1` to the URL fragment for diagnostics. `STREAM_UNAVAILABLE` indicates a source/transport failure; `STREAM_DECODE` indicates decoder failure; `PLAYBACK_TIMEOUT` indicates no startup progress for 120 seconds, or no playback within 240 seconds of the current startup attempt.

The game's Media Player calls `.sync()` every 300 ms. Ordinary clock updates cannot restart positioning before frames advance, even when a seek takes more than three seconds. Drift corrections wait at least 15 seconds and 15 rendered frames after the previous seek. Explicit timeline jumps remain immediate. Transient HTTP failures, timeouts and a saturated native bridge are retried up to twice; failed initial stream loads re-resolve the source up to twice. Cancellation discards old bytes without bypassing native HTTP concurrency limits.

On 2026-11-13, the local smoke check passed on Chrome 157 with native decoding/WebGL disabled, **5-second segment delays**, 300 ms game sync and an injected HTTP 502 on the first segment: one startup seek, 76 additional steady-playback frames, pause/seek/resume and 1.46 MB transferred. This run verifies the fault-recovery changes in the browser adapter; the live GMod transport still needs verification on affected clients. Reproduce with `STOCK_CEF=1 SEGMENT_DELAY_MS=5000 FAIL_FIRST_SEGMENT=1 node tools/smoke-playback.cjs` and `PLAYER_URL` pointing to the updated page.

All ten sources passed the strengthened **Chromium 86** check with 300 ms game updates, 350 ms segment delays, WebGL disabled and native decoding blocked: [run 43235886680](https://github.com/Satan1st/autonomous-tv-player/actions/runs/43235886680). Every source performed one initial seek and rendered 70–92 further frames during the steady-playback check before pause/seek/resume.

## Verification

```sh
node player.spec.js
```

The browser smoke check injects the same native transport interface, streams actual Rutube fragments into RAM, and checks software video/audio rendering, pause, seek, resume and bounded transfer size. Results identify the browser used. Game CEF rendering/performance must also be playtested; passing modern Chromium alone is not proof of stock GMod compatibility.

On 2026-11-12, all ten cassette sources passed this check on **Chromium 86.0.4217.0**: [run 43224547461](https://github.com/Satan1st/autonomous-tv-player/actions/runs/43224547461). Each test streamed at most 4.1 MB of fragments, including a seek to 70% of the film; no film file was saved. This verifies the decoder in a matching Chromium generation, not the live GMod DHTML/native-HTTP integration or the television's in-world rendering.

After the in-game log exposed libmedia's WebGL-dependent MSE fallback, the Canvas 2D adapter passed all ten sources on **Chromium 86 with WebGL disabled and native media decoding blocked**: [run 43229026796](https://github.com/Satan1st/autonomous-tv-player/actions/runs/43229026796). The check asserts `renderer=canvas2d`, `nativeMedia=false` and zero attempts to create a native media source buffer.

## Removed approach

The earlier Actions-based whole-film WebM converter was cancelled and removed after the requirement was clarified. Release `media-webm-v1` and its ten generated assets (nine films and a synthetic demo) were deleted. GitHub hosts software only.
