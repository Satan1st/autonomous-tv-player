(function () {
    'use strict';

    function convert420(yPlane, uPlane, vPlane, strides, width, height, fullRange, bt709, rgba) {
        var yOffset = fullRange ? 0 : 16, yScale = fullRange ? 256 : 298;
        var red = fullRange ? (bt709 ? 403 : 359) : (bt709 ? 459 : 409);
        var greenU = fullRange ? (bt709 ? 48 : 88) : (bt709 ? 55 : 100);
        var greenV = fullRange ? (bt709 ? 120 : 183) : (bt709 ? 136 : 208);
        var blue = fullRange ? (bt709 ? 475 : 454) : (bt709 ? 541 : 516);
        for (var row = 0, output = 0; row < height; row++) {
            var yRow = row * strides[0], uRow = (row >> 1) * strides[1], vRow = (row >> 1) * strides[2];
            for (var column = 0; column < width; column++) {
                var y = (yPlane[yRow + column] - yOffset) * yScale;
                var u = uPlane[uRow + (column >> 1)] - 128;
                var v = vPlane[vRow + (column >> 1)] - 128;
                rgba[output++] = (y + red * v + 128) >> 8;
                rgba[output++] = (y - greenU * u - greenV * v + 128) >> 8;
                rgba[output++] = (y + blue * u + 128) >> 8;
                rgba[output++] = 255;
            }
        }
    }

    window.ixCanvasVideo = {convert420: convert420, renderer: 'canvas2d', installed: false};
    if (!window.AVPlayer || !window.webpackChunkAVPlayer) return;

    // Module IDs and AVFrame offsets belong to the pinned libmedia 4bd0fdae build.
    window.webpackChunkAVPlayer.push([['ix-canvas2d'], {}, function (require) {
        var read = require(9983).f;
        var mapBytes = require(63674).s3;
        var Pipeline = require(99090).A;
        var support = require(93463).A;
        if (!read || typeof mapBytes !== 'function' || typeof Pipeline.prototype.createRender !== 'function') {
            throw new Error('Canvas adapter does not match the decoder build');
        }
        window.ixCanvasVideo.capabilities = {wasm: support.wasmBaseSupported, webgl: !!support.webgl, audio: !!support.audioContext};

        function CanvasRenderer(canvas, options) {
            this.canvas = canvas;
            this.options = options;
            this.scratch = document.createElement('canvas');
            this.angle = 0;
            this.flipX = this.flipY = false;
            this.mode = options.renderMode || 0;
        }
        CanvasRenderer.prototype.init = async function () {
            this.context = this.canvas.getContext('2d', {alpha: false});
            this.scratchContext = this.scratch.getContext('2d', {alpha: false});
            if (!this.context || !this.scratchContext) throw new Error('Canvas 2D is unavailable');
        };
        CanvasRenderer.isSupport = function (frame) {
            return typeof frame === 'number' && (read[15](frame + 80) === 0 || read[15](frame + 80) === 12);
        };
        CanvasRenderer.prototype.render = function (frame) {
            if (!CanvasRenderer.isSupport(frame)) throw new Error('Canvas renderer requires 8-bit YUV420 video');
            var width = read[15](frame + 68), height = read[15](frame + 72);
            var strides = [read[15](frame + 32), read[15](frame + 36), read[15](frame + 40)];
            if (width < 1 || height < 1 || width > 4096 || height > 4096 || strides[0] < width
                || strides[1] < Math.ceil(width / 2) || strides[2] < Math.ceil(width / 2)) {
                throw new Error('Invalid software-decoded frame dimensions');
            }
            if (!this.image || this.image.width !== width || this.image.height !== height) {
                this.scratch.width = width; this.scratch.height = height;
                this.image = this.scratchContext.createImageData(width, height);
            }
            convert420(mapBytes(read[20](frame), strides[0] * height),
                mapBytes(read[20](frame + 4), strides[1] * Math.ceil(height / 2)),
                mapBytes(read[20](frame + 8), strides[2] * Math.ceil(height / 2)),
                strides, width, height, read[15](frame + 208) === 2 || read[15](frame + 80) === 12,
                read[15](frame + 220) === 1, this.image.data);
            this.scratchContext.putImageData(this.image, 0, 0);
            this.present();
        };
        CanvasRenderer.prototype.clear = function () {
            if (!this.context) return;
            this.context.setTransform(1, 0, 0, 1, 0, 0);
            this.context.fillStyle = '#000';
            this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        };
        CanvasRenderer.prototype.present = function () {
            if (!this.image || !this.context) return;
            this.clear();
            var width = this.image.width * (this.options.sar || 1), height = this.image.height;
            var radians = this.angle * Math.PI / 180;
            var boxWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
            var boxHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
            var scale = (this.mode === 1 ? Math.max : Math.min)(this.canvas.width / boxWidth, this.canvas.height / boxHeight);
            this.context.save();
            this.context.translate(this.canvas.width / 2, this.canvas.height / 2);
            this.context.rotate(radians);
            this.context.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
            this.context.drawImage(this.scratch, -width * scale / 2, -height * scale / 2, width * scale, height * scale);
            this.context.restore();
        };
        CanvasRenderer.prototype.viewport = function (width, height) {
            var ratio = this.options.devicePixelRatio || 1;
            this.canvas.width = Math.max(1, Math.round(width * ratio));
            this.canvas.height = Math.max(1, Math.round(height * ratio));
            this.present();
        };
        CanvasRenderer.prototype.setRotate = function (angle) { this.angle = angle; this.present(); };
        CanvasRenderer.prototype.setRenderMode = function (mode) { this.mode = mode; this.present(); };
        CanvasRenderer.prototype.enableHorizontalFlip = function (enabled) { this.flipX = enabled; this.present(); };
        CanvasRenderer.prototype.enableVerticalFlip = function (enabled) { this.flipY = enabled; this.present(); };
        CanvasRenderer.prototype.destroy = function () {
            this.image = this.context = this.scratchContext = this.scratch = this.canvas = null;
        };

        Pipeline.prototype.createRender = async function (task, frame) {
            if (task.renderCreating) return;
            task.renderCreating = true;
            task.renderRedyed = false;
            try {
                if (task.render) task.render.destroy();
                task.render = new CanvasRenderer(task.canvas, {sar: task.sar, devicePixelRatio: task.devicePixelRatio, renderMode: task.renderMode});
                task.isSupport = CanvasRenderer.isSupport;
                await task.render.init();
                task.render.viewport(task.viewportWidth, task.viewportHeight);
                task.render.setRotate(task.renderRotate || 0);
                task.render.enableHorizontalFlip(task.flipHorizontal || false);
                task.render.enableVerticalFlip(task.flipVertical || false);
                task.render.render(frame);
                task.renderRedyed = true;
                task.renderRecreateCount = 0;
            } finally { task.renderCreating = false; }
        };
        AVPlayer.prototype.checkUseMSE = async function () {
            if (!support.wasmBaseSupported || !support.audioContext) throw new Error('WebAssembly or Web Audio is unavailable');
            return false;
        };
        window.ixCanvasVideo.installed = true;
    }]);
}());
