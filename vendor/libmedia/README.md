# libmedia decoder distribution

Upstream: https://github.com/zhaohappy/libmedia/tree/4bd0fdae

AVPlayer build: `v1.3.1-6-g4bd0fdae`, downloaded from the upstream project site. Baseline H.264/AAC decoders, audio resampling and time stretching are taken from the matching source revision. `manifest.json` records source URLs and SHA-256 for every vendored file. `tools/vendor_decoder.py` retrieves the distribution.

License: LGPL-3.0-or-later. See `COPYING.LGPLv3` and `COPYING.GPLv3`. Corresponding buildable sources and dependency/submodule references are available at the upstream revision above; FFmpeg sources are linked from that repository. These unmodified library files remain separate from the television controller and can be replaced with compatible builds.

Only software libraries are included here. No film data is stored in this directory or repository.
