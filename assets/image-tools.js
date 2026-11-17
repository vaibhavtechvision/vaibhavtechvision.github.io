/* Vaibhav Tech Vision - shared image helpers.
   Every function runs fully inside the browser. No photo is uploaded anywhere. */
(function () {
  'use strict';
  var VTV = {};

  /* ---------- loading ---------- */

  // Load a File object into an HTMLImageElement. Modern browsers apply EXIF
  // rotation automatically when drawing to canvas.
  VTV.loadImage = function (file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  };

  VTV.imageToCanvas = function (img) {
    var c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  };

  VTV.copyCanvas = function (src) {
    var c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  };

  VTV.resizedCanvas = function (src, w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };

  // Draw the source onto a plain white canvas (used for JPEG, which has no
  // transparency, and for the white-background choice).
  VTV.flattenOnWhite = function (src) {
    var c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
    return c;
  };

  /* ---------- encoding ---------- */

  VTV.toBlob = function (canvas, mime, quality) {
    var src = mime === 'image/jpeg' ? VTV.flattenOnWhite(canvas) : canvas;
    return new Promise(function (resolve, reject) {
      src.toBlob(function (b) {
        if (b) { resolve(b); } else { reject(new Error('encode')); }
      }, mime, quality);
    });
  };

  VTV.formatBytes = function (n) {
    if (n < 1024) { return n + ' bytes'; }
    if (n < 1024 * 1024) { return (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB'; }
    return (n / (1024 * 1024)).toFixed(2).replace(/\.?0+$/, '') + ' MB';
  };

  VTV.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  };

  /* ---------- compress to an exact target size ---------- */

  // Tries quality steps first, then makes the image smaller step by step.
  // Works for 'image/jpeg' and 'image/webp' (quality search) and 'image/png'
  // (shrinking only, since PNG has no quality setting).
  // Returns { blob, canvas, width, height, quality, scalePercent, reached }.
  // reached is false when the target could not be hit before the image would
  // become a thumbnail; the smallest attempt is returned for honesty.
  VTV.compressToTarget = function (srcCanvas, targetBytes, mime) {
    var scale = 1;
    var smallest = null; // smallest blob we managed, if target is unreachable
    var steps = 0;

    function track(canvas, blob, q) {
      if (!smallest || blob.size < smallest.blob.size) {
        smallest = { blob: blob, canvas: canvas, quality: q };
      }
    }
    function shrink() {
      steps++;
      scale = scale * 0.8;
      if (steps > 12 || Math.min(srcCanvas.width, srcCanvas.height) * scale < 48) {
        var s = smallest;
        return { blob: s.blob, canvas: s.canvas, width: s.canvas.width, height: s.canvas.height,
          quality: Math.round(s.quality * 100), scalePercent: Math.round((s.canvas.width / srcCanvas.width) * 100),
          reached: false };
      }
      return tryScale();
    }

    function tryScale() {
      var canvas = scale === 1 ? srcCanvas :
        VTV.resizedCanvas(srcCanvas, srcCanvas.width * scale, srcCanvas.height * scale);

      if (mime === 'image/png') {
        return VTV.toBlob(canvas, mime).then(function (blob) {
          track(canvas, blob, 1);
          if (blob.size <= targetBytes) {
            return { blob: blob, canvas: canvas, width: canvas.width, height: canvas.height,
              quality: null, scalePercent: Math.round(scale * 100), reached: true };
          }
          return shrink();
        });
      }

      var lo = 0.02, hi = 0.95, best = null, bestQ = 0;
      var iterations = 0;
      function search() {
        if (iterations >= 7) { return finishScale(best, bestQ, canvas); }
        var q = (lo + hi) / 2;
        iterations++;
        return VTV.toBlob(canvas, mime, q).then(function (blob) {
          track(canvas, blob, q);
          if (blob.size <= targetBytes) {
            best = blob; bestQ = q; lo = q; // under target: try better quality
          } else {
            hi = q;
          }
          return search();
        });
      }
      return search();
    }

    function finishScale(best, bestQ, canvas) {
      if (best) {
        // Very low JPEG quality looks blocky; a smaller image at better
        // quality usually looks nicer, so prefer shrinking once quality
        // drops below 15 percent.
        if (bestQ < 0.15 && scale > 0.3 && steps < 12 &&
            Math.min(srcCanvas.width, srcCanvas.height) * scale * 0.8 >= 48) {
          steps++;
          scale = scale * 0.8;
          return tryScale();
        }
        return { blob: best, canvas: canvas, width: canvas.width, height: canvas.height,
          quality: Math.round(bestQ * 100), scalePercent: Math.round(scale * 100), reached: true };
      }
      return shrink();
    }

    return tryScale();
  };

  /* ---------- passport photo geometry ---------- */

  VTV.mmToPx = function (mm, dpi) {
    return Math.round((mm / 25.4) * dpi);
  };

  // Cover-crop window: the biggest source area with the target's shape,
  // zoomed by zoomPercent and shifted by offX/offY output pixels.
  VTV.coverCrop = function (srcW, srcH, outW, outH, zoomPercent, offX, offY) {
    var scale = Math.max(outW / srcW, outH / srcH) * (zoomPercent / 100);
    var sw = outW / scale;
    var sh = outH / scale;
    if (sw > srcW) { sw = srcW; sh = outH / (outW / sw); }
    if (sh > srcH) { sh = srcH; sw = outW / (outH / sh); }
    var sx = (srcW - sw) / 2 - offX / scale;
    var sy = (srcH - sh) / 2 - offY / scale;
    sx = Math.min(Math.max(0, sx), srcW - sw);
    sy = Math.min(Math.max(0, sy), srcH - sh);
    return { sx: sx, sy: sy, sw: sw, sh: sh };
  };

  /* ---------- background: AI person cut-out (in-browser model) ---------- */

  var segmenterPromise = null;

  // Loads the MediaPipe selfie segmenter from this site's own files.
  // visionBase is the folder that holds vision_bundle.mjs, the wasm files
  // and selfie_segmenter.tflite, for example '../assets/lib/vision'.
  VTV.loadSegmenter = function (visionBase) {
    if (!segmenterPromise) {
      var base = new URL(visionBase.replace(/\/?$/, '/'), document.baseURI).href;
      segmenterPromise = import(base + 'vision_bundle.mjs').then(function (mod) {
        return mod.FilesetResolver.forVisionTasks(base).then(function (fileset) {
          return mod.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: base + 'selfie_segmenter.tflite', delegate: 'CPU' },
            runningMode: 'IMAGE',
            outputCategoryMask: false,
            outputConfidenceMasks: true
          });
        });
      });
      segmenterPromise.catch(function () { segmenterPromise = null; });
    }
    return segmenterPromise;
  };

  // Composite the person in srcCanvas onto a plain white background.
  // Returns a Promise of a new canvas. Rejects if the model cannot load.
  VTV.whiteBackgroundAI = function (srcCanvas, visionBase) {
    return VTV.loadSegmenter(visionBase).then(function (segmenter) {
      // Segment a downscaled copy for speed; the mask is upscaled afterwards.
      var maxSide = 768;
      var factor = Math.min(1, maxSide / Math.max(srcCanvas.width, srcCanvas.height));
      var small = factor === 1 ? srcCanvas :
        VTV.resizedCanvas(srcCanvas, srcCanvas.width * factor, srcCanvas.height * factor);
      return new Promise(function (resolve, reject) {
        segmenter.segment(small, function (result) {
          try {
            var masks = result.confidenceMasks;
            if (!masks || !masks.length) { reject(new Error('nomask')); return; }
            // The person channel: the model returns one mask per category
            // (0 background, 1 person). With a single mask it is the person.
            var mask = masks.length > 1 ? masks[masks.length - 1] : masks[0];
            var data = mask.getAsFloat32Array();
            var mw = mask.width, mh = mask.height;
            // Draw the mask into a small canvas, then upscale with smoothing
            // so the edge is softly feathered instead of jagged.
            var mc = document.createElement('canvas');
            mc.width = mw; mc.height = mh;
            var mctx = mc.getContext('2d');
            var mi = mctx.createImageData(mw, mh);
            for (var i = 0; i < data.length; i++) {
              var v = data[i];
              // Gentle threshold curve: below 0.4 is background, above 0.6 is person.
              var a = (v - 0.4) / 0.2;
              a = Math.min(1, Math.max(0, a));
              var g = Math.round(a * 255);
              mi.data[i * 4] = g; mi.data[i * 4 + 1] = g; mi.data[i * 4 + 2] = g;
              mi.data[i * 4 + 3] = 255;
            }
            mctx.putImageData(mi, 0, 0);
            var big = VTV.resizedCanvas(mc, srcCanvas.width, srcCanvas.height);
            var bctx = big.getContext('2d');
            var maskData = bctx.getImageData(0, 0, big.width, big.height).data;

            var out = document.createElement('canvas');
            out.width = srcCanvas.width; out.height = srcCanvas.height;
            var octx = out.getContext('2d');
            octx.drawImage(srcCanvas, 0, 0);
            var px = octx.getImageData(0, 0, out.width, out.height);
            var d = px.data;
            for (var p = 0; p < d.length; p += 4) {
              var m = maskData[p] / 255; // 1 = person, 0 = background
              d[p]     = Math.round(d[p] * m + 255 * (1 - m));
              d[p + 1] = Math.round(d[p + 1] * m + 255 * (1 - m));
              d[p + 2] = Math.round(d[p + 2] * m + 255 * (1 - m));
              d[p + 3] = 255;
            }
            octx.putImageData(px, 0, 0);
            mask.close();
            resolve(out);
          } catch (e) { reject(e); }
        });
      });
    });
  };

  /* ---------- background: simple plain-background whitening (fallback) ---------- */

  // Best-effort whitening for photos taken against a fairly even background:
  // samples the corner colour and floods inwards from the edges, whitening
  // pixels that look like that background. Works on plain walls only.
  VTV.whiteBackgroundFlood = function (srcCanvas, tolerance) {
    var w = srcCanvas.width, h = srcCanvas.height;
    var ctx = srcCanvas.getContext('2d');
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    var tol = tolerance || 42;

    // Average the four corners as the background colour.
    var corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
    var br = 0, bg = 0, bb = 0;
    corners.forEach(function (i) { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; });
    br /= 4; bg /= 4; bb /= 4;

    function likeBg(i) {
      var dr = d[i] - br, dg = d[i + 1] - bg, db = d[i + 2] - bb;
      return Math.sqrt(dr * dr + dg * dg + db * db) <= tol;
    }

    var mask = new Uint8Array(w * h); // 1 = background
    var stack = [];
    for (var x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + (w - 1)); }
    while (stack.length) {
      var p = stack.pop();
      if (mask[p]) { continue; }
      if (!likeBg(p * 4)) { continue; }
      mask[p] = 1;
      var px = p % w, py = (p - px) / w;
      if (px > 0) { stack.push(p - 1); }
      if (px < w - 1) { stack.push(p + 1); }
      if (py > 0) { stack.push(p - w); }
      if (py < h - 1) { stack.push(p + w); }
    }

    // Soften the mask edge with one blur pass.
    var soft = new Uint8Array(w * h);
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var sum = 0, cnt = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = xx + dx, ny = yy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) { sum += mask[ny * w + nx]; cnt++; }
          }
        }
        soft[yy * w + xx] = Math.round((sum / cnt) * 255);
      }
    }

    for (var q = 0; q < w * h; q++) {
      var m = 1 - soft[q] / 255; // 1 = keep person
      var o = q * 4;
      d[o] = Math.round(d[o] * m + 255 * (1 - m));
      d[o + 1] = Math.round(d[o + 1] * m + 255 * (1 - m));
      d[o + 2] = Math.round(d[o + 2] * m + 255 * (1 - m));
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return srcCanvas;
  };

  window.VTVImage = VTV;
})();
