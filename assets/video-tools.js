/* Video Editor tools for Vaibhav Tech Vision.
   Everything runs in the browser with the canvas, MediaRecorder and Web Audio
   APIs. No file is uploaded anywhere and no engine is downloaded. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function fmtBytes(b) {
    if (b < 1024) return b + ' bytes';
    if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function fmtTime(s) {
    s = Math.round(s);
    var m = Math.floor(s / 60), r = s % 60;
    return m > 0 ? m + ' min ' + r + ' s' : r + ' s';
  }
  function setText(id, msg) { var el = $(id); if (el) el.textContent = msg; }
  function show(id) { var el = $(id); if (el) el.hidden = false; }

  var AC = window.AudioContext || window.webkitAudioContext;
  var audioCtx = null, audioDest = null;
  function getAudioGraph() {
    if (!audioCtx) {
      audioCtx = new AC();
      audioDest = audioCtx.createMediaStreamDestination();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return { ctx: audioCtx, dest: audioDest };
  }

  /* Pick the best supported video recording format. */
  function pickVideoMime(wantMp4) {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
    var cands = wantMp4
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < cands.length; i++) {
      if (MediaRecorder.isTypeSupported(cands[i])) return cands[i];
    }
    return null;
  }
  function extOf(mime) { return mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm'; }

  function once(el, ev) {
    return new Promise(function (res) {
      el.addEventListener(ev, function h() { el.removeEventListener(ev, h); res(); });
    });
  }

  /* Load a video file into an off-screen element and read its metadata. */
  function loadVideo(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'auto';
      v.playsInline = true;
      var settled = false;
      v.onerror = function () {
        if (settled) return; settled = true;
        URL.revokeObjectURL(url);
        reject(new Error('Your browser could not read this video file. MP4 or WebM files work best.'));
      };
      v.onloadedmetadata = function () {
        if (settled) return;
        function fin() {
          settled = true;
          v.currentTime = 0;
          resolve({ video: v, url: url, duration: v.__dur, w: v.videoWidth, h: v.videoHeight });
        }
        if (!v.videoWidth) {
          settled = true; URL.revokeObjectURL(url);
          reject(new Error('This file has no picture track your browser can read.'));
          return;
        }
        if (isFinite(v.duration) && v.duration > 0) { v.__dur = v.duration; fin(); return; }
        /* Some WebM files do not carry their length. Seek far to find it. */
        v.addEventListener('seeked', function sh() {
          v.removeEventListener('seeked', sh);
          v.__dur = v.currentTime;
          v.addEventListener('seeked', function sh2() { v.removeEventListener('seeked', sh2); fin(); });
          v.currentTime = 0;
        });
        v.currentTime = 1e10;
      };
      v.src = url;
    });
  }

  /* Wire a download button to a blob. */
  function wireDownload(btnId, blob, name) {
    var btn = $(btnId);
    if (!btn) return;
    if (btn.__url) URL.revokeObjectURL(btn.__url);
    btn.__url = URL.createObjectURL(blob);
    btn.__name = name;
  }
  document.addEventListener('click', function (e) {
    var b = e.target;
    if (b && b.tagName === 'BUTTON' && b.__url) {
      var a = document.createElement('a');
      a.href = b.__url;
      a.download = b.__name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });

  function baseName(file) {
    var n = file.name || 'video';
    var i = n.lastIndexOf('.');
    return i > 0 ? n.slice(0, i) : n;
  }

  /* Play a video (or part of it) through a canvas and record the result.
     o: {video, seconds, offsetSec, rate, mime, vbps, withAudio, canvas, statusId, label} */
  function playRecord(o) {
    return new Promise(function (resolve, reject) {
      var video = o.video;
      var canvas = o.canvas || document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var g2d = canvas.getContext('2d');
      g2d.fillStyle = '#000';
      g2d.fillRect(0, 0, canvas.width, canvas.height);
      var fps = 30;
      var vstream = canvas.captureStream(fps);
      var tracks = vstream.getVideoTracks().slice();
      var srcNode = null;
      if (o.withAudio) {
        var g = getAudioGraph();
        try { srcNode = g.ctx.createMediaElementSource(video); } catch (e) { srcNode = null; }
        if (srcNode) {
          srcNode.connect(g.dest);
          tracks = tracks.concat(g.dest.stream.getAudioTracks());
        }
      }
      var stream = new MediaStream(tracks);
      var opts = { mimeType: o.mime, audioBitsPerSecond: 96000 };
      if (o.vbps) opts.videoBitsPerSecond = o.vbps;
      var rec;
      try { rec = new MediaRecorder(stream, opts); }
      catch (e) { reject(new Error('Your browser could not start a video recorder.')); return; }
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var realSeconds = o.seconds / (o.rate || 1);
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        video.pause();
        if (rec.state !== 'inactive') {
          rec.onstop = function () {
            if (srcNode) { try { srcNode.disconnect(); } catch (e) {} }
            stream.getTracks().forEach(function (t) { t.stop(); });
            var blob = new Blob(chunks, { type: o.mime.split(';')[0] });
            if (blob.size === 0) {
              reject(new Error('nothing was recorded. Please press the button and try again.'));
            } else {
              resolve(blob);
            }
          };
          rec.stop();
        } else {
          resolve(new Blob(chunks, { type: o.mime.split(';')[0] }));
        }
      }
      video.playbackRate = o.rate || 1;
      video.preservesPitch = true;
      video.muted = false;
      video.currentTime = o.offsetSec || 0;
      once(video, 'seeked').then(function () {
        rec.start(250);
        video.play().then(function () {
          var draw = function () {
            if (done) return;
            g2d.drawImage(video, 0, 0, canvas.width, canvas.height);
            if (!video.paused && !video.ended) requestAnimationFrame(draw);
          };
          draw();
          var t0 = performance.now();
          var iv = setInterval(function () {
            var covered = video.currentTime - (o.offsetSec || 0);
            var realElapsed = (performance.now() - t0) / 1000;
            if (o.statusId) {
              setText(o.statusId, o.label + ' Working. About ' + fmtTime(Math.min(realElapsed, realSeconds)) +
                ' of ' + fmtTime(realSeconds) + ' done. Please keep this page open.');
            }
            if (covered >= o.seconds - 0.08 || video.ended) {
              clearInterval(iv);
              setTimeout(finish, 350); /* let the recorder flush the tail */
            }
          }, 400);
        }).catch(function () {
          reject(new Error('Your browser refused to play this video, so it could not be processed.'));
        });
      });
    });
  }

  /* Audio encoders (same proven code as the Audio Editor page). */
  function encodeWav(buffer) {
    var channels = Math.min(2, buffer.numberOfChannels);
    var sr = buffer.sampleRate;
    var len = buffer.length * channels * 2;
    var out = new ArrayBuffer(44 + len);
    var v = new DataView(out);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + len, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * channels * 2, true);
    v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len, true);
    var off = 44, chans = [];
    for (var c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
    for (var i = 0; i < buffer.length; i++) {
      for (var ch = 0; ch < channels; ch++) {
        var s = Math.max(-1, Math.min(1, chans[ch][i]));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }
    return new Blob([out], { type: 'audio/wav' });
  }
  function encodeMp3(buffer, kbps) {
    var channels = Math.min(2, buffer.numberOfChannels);
    var enc = new lamejs.Mp3Encoder(channels, buffer.sampleRate, kbps || 128);
    function to16(f) {
      var a = new Int16Array(f.length);
      for (var i = 0; i < f.length; i++) {
        var s = Math.max(-1, Math.min(1, f[i]));
        a[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return a;
    }
    var left = to16(buffer.getChannelData(0));
    var right = channels === 2 ? to16(buffer.getChannelData(1)) : null;
    var parts = [];
    var block = 1152;
    for (var i = 0; i < buffer.length; i += block) {
      var l = left.subarray(i, i + block);
      var r = right ? right.subarray(i, i + block) : l;
      var d = channels === 2 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (d.length) parts.push(new Int8Array(d));
    }
    var end = enc.flush();
    if (end.length) parts.push(new Int8Array(end));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  /* Standard per-section file wiring: load video, announce info, reveal controls. */
  function wireVideoInput(prefix, onReady) {
    var inp = $(prefix + '-file');
    if (!inp) return;
    var state = { loaded: null };
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      setText(prefix + '-error', '');
      setText(prefix + '-info', '');
      $(prefix + '-controls').hidden = true;
      if (!f) { state.loaded = null; return; }
      setText(prefix + '-info', 'Reading ' + f.name + '...');
      loadVideo(f).then(function (lv) {
        state.loaded = lv;
        state.file = f;
        setText(prefix + '-info', 'Loaded ' + f.name + ': ' + fmtTime(lv.duration) +
          ' long, ' + lv.w + ' by ' + lv.h + ' pixels, ' + fmtBytes(f.size) + '.');
        $(prefix + '-controls').hidden = false;
        if (onReady) onReady(lv, f);
      }).catch(function (err) {
        state.loaded = null;
        setText(prefix + '-info', '');
        setText(prefix + '-error', 'Sorry: ' + err.message);
      });
    });
    return state;
  }

  function guardBusy(btn) {
    if (btn.disabled) return true;
    btn.disabled = true;
    return false;
  }
  function unbusy(btn) { btn.disabled = false; }

  /* ---------- 1. Video Trimmer ---------- */
  (function () {
    var state = wireVideoInput('tr', function (lv) {
      $('tr-end').value = Math.max(0, Math.floor(lv.duration * 10) / 10);
    });
    var btn = $('tr-go');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('tr-error', '');
      var lv = state.loaded;
      if (!lv) { setText('tr-error', 'Please choose a video file first.'); unbusy(btn); return; }
      var start = parseFloat($('tr-start').value), end = parseFloat($('tr-end').value);
      if (!(start >= 0) || !(end > start)) {
        setText('tr-error', 'Please type a start second and an end second after it.');
        unbusy(btn); return;
      }
      if (start >= lv.duration) {
        setText('tr-error', 'The start second is beyond the end of this ' + fmtTime(lv.duration) + ' video.');
        unbusy(btn); return;
      }
      end = Math.min(end, lv.duration);
      var mime = pickVideoMime(false);
      if (!mime) { setText('tr-error', 'Sorry: your browser cannot record video.'); unbusy(btn); return; }
      setText('tr-status', 'Starting. The trim happens in real time.');
      playRecord({
        video: lv.video, seconds: end - start, offsetSec: start, rate: 1,
        mime: mime, withAudio: true, statusId: 'tr-status', label: 'Trimming.'
      }).then(function (blob) {
        var ext = extOf(mime);
        $('tr-video').src = URL.createObjectURL(blob);
        wireDownload('tr-dl', blob, baseName(state.file) + '-trimmed.' + ext);
        show('tr-result');
        setText('tr-status', 'Done. Your trimmed video is ' + fmtTime(end - start) + ' long and ' +
          fmtBytes(blob.size) + ', in ' + ext.toUpperCase() + ' format. You can play it below or press the download button.');
        unbusy(btn);
      }).catch(function (err) {
        setText('tr-status', '');
        setText('tr-error', 'Sorry: ' + err.message);
        unbusy(btn);
      });
    });
  })();

  /* ---------- 2. Video to Audio ---------- */
  (function () {
    var inp = $('va-file');
    if (!inp) return;
    var file = null;
    inp.addEventListener('change', function () {
      file = inp.files && inp.files[0] || null;
      setText('va-error', '');
      if (file) {
        setText('va-info', 'Loaded ' + file.name + ' (' + fmtBytes(file.size) + ').');
        show('va-controls');
      } else {
        setText('va-info', '');
        $('va-controls').hidden = true;
      }
    });
    var btn = $('va-go');
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('va-error', '');
      if (!file) { setText('va-error', 'Please choose a video file first.'); unbusy(btn); return; }
      var wantMp3 = $('va-format').value === 'mp3';
      setText('va-status', 'Reading the sound out of the video...');
      var g = getAudioGraph();
      file.arrayBuffer().then(function (ab) {
        return g.ctx.decodeAudioData(ab);
      }).then(function (buf) {
        setText('va-status', 'Saving the sound as ' + (wantMp3 ? 'MP3' : 'WAV') + '...');
        var blob = wantMp3 ? encodeMp3(buf, 128) : encodeWav(buf);
        $('va-audio').src = URL.createObjectURL(blob);
        wireDownload('va-dl', blob, baseName(file) + '-sound.' + (wantMp3 ? 'mp3' : 'wav'));
        show('va-result');
        setText('va-status', 'Done. The sound is ' + fmtTime(buf.duration) + ' long and ' + fmtBytes(blob.size) +
          '. You can listen below or press the download button.');
        unbusy(btn);
      }).catch(function () {
        setText('va-status', '');
        setText('va-error', 'Sorry: your browser could not read the sound in this video file. MP4 or WebM files work best.');
        unbusy(btn);
      });
    });
  })();

  /* ---------- 3. Video Compressor ---------- */
  (function () {
    var state = wireVideoInput('cp');
    var btn = $('cp-go');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('cp-error', '');
      var lv = state.loaded;
      if (!lv) { setText('cp-error', 'Please choose a video file first.'); unbusy(btn); return; }
      var targetMB = parseFloat($('cp-target').value);
      if (!(targetMB >= 0.5)) { setText('cp-error', 'Please type a target size of at least 1 MB.'); unbusy(btn); return; }
      var totalBps = (targetMB * 8 * 1024 * 1024) / lv.duration;
      var audioBps = 96000;
      var vbps = Math.floor(totalBps - audioBps);
      var floor = 80000;
      var note = '';
      if (vbps < floor) {
        vbps = floor;
        note = ' That size is too small for a video this long, so the tool used the lowest usable quality; the result will be bigger than ' + targetMB + ' MB.';
      }
      var mime = pickVideoMime(false);
      if (!mime) { setText('cp-error', 'Sorry: your browser cannot record video.'); unbusy(btn); return; }
      setText('cp-status', 'Starting. Compressing happens in real time.');
      playRecord({
        video: lv.video, seconds: lv.duration, offsetSec: 0, rate: 1,
        mime: mime, vbps: vbps, withAudio: true, statusId: 'cp-status', label: 'Compressing.'
      }).then(function (blob) {
        $('cp-video').src = URL.createObjectURL(blob);
        wireDownload('cp-dl', blob, 'compressed-' + baseName(state.file) + '.' + extOf(mime));
        show('cp-result');
        setText('cp-status', 'Done. The compressed video is ' + fmtBytes(blob.size) + '.' + note +
          ' You can play it below or press the download button.');
        unbusy(btn);
      }).catch(function (err) {
        setText('cp-status', '');
        setText('cp-error', 'Sorry: ' + err.message);
        unbusy(btn);
      });
    });
  })();

  /* ---------- 4. Format Converter ---------- */
  (function () {
    var state = wireVideoInput('fc');
    var btn = $('fc-go');
    if (!btn) return;
    var mp4Mime = pickVideoMime(true);
    var sel = $('fc-format');
    if (!mp4Mime) {
      var opt = sel.querySelector('option[value="mp4"]');
      if (opt) opt.disabled = true;
      sel.value = 'webm';
    }
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('fc-error', '');
      var lv = state.loaded;
      if (!lv) { setText('fc-error', 'Please choose a video file first.'); unbusy(btn); return; }
      var wantMp4 = sel.value === 'mp4';
      var mime = pickVideoMime(wantMp4);
      if (!mime) {
        setText('fc-error', 'Sorry: your browser cannot make ' + (wantMp4 ? 'MP4' : 'WebM') + ' video.');
        unbusy(btn); return;
      }
      setText('fc-status', 'Starting. Converting happens in real time.');
      playRecord({
        video: lv.video, seconds: lv.duration, offsetSec: 0, rate: 1,
        mime: mime, withAudio: true, statusId: 'fc-status', label: 'Converting.'
      }).then(function (blob) {
        var ext = extOf(mime);
        $('fc-video').src = URL.createObjectURL(blob);
        wireDownload('fc-dl', blob, baseName(state.file) + '-converted.' + ext);
        show('fc-result');
        setText('fc-status', 'Done. Your video is now a ' + fmtBytes(blob.size) + ' ' + ext.toUpperCase() +
          ' file. You can play it below or press the download button.');
        unbusy(btn);
      }).catch(function (err) {
        setText('fc-status', '');
        setText('fc-error', 'Sorry: ' + err.message);
        unbusy(btn);
      });
    });
  })();

  /* ---------- 5. Speed Changer ---------- */
  (function () {
    var state = wireVideoInput('sp');
    var btn = $('sp-go');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('sp-error', '');
      var lv = state.loaded;
      if (!lv) { setText('sp-error', 'Please choose a video file first.'); unbusy(btn); return; }
      var pct = parseFloat($('sp-percent').value);
      if (!(pct >= 25 && pct <= 400)) {
        setText('sp-error', 'Please type a speed between 25 and 400 percent.');
        unbusy(btn); return;
      }
      var mime = pickVideoMime(false);
      if (!mime) { setText('sp-error', 'Sorry: your browser cannot record video.'); unbusy(btn); return; }
      setText('sp-status', 'Starting. Changing speed happens in real time.');
      playRecord({
        video: lv.video, seconds: lv.duration, offsetSec: 0, rate: pct / 100,
        mime: mime, withAudio: true, statusId: 'sp-status', label: 'Changing speed.'
      }).then(function (blob) {
        var newDur = lv.duration / (pct / 100);
        $('sp-video').src = URL.createObjectURL(blob);
        wireDownload('sp-dl', blob, baseName(state.file) + '-' + pct + '-percent.' + extOf(mime));
        show('sp-result');
        setText('sp-status', 'Done. The video now plays at ' + pct + ' percent speed and is ' +
          fmtTime(newDur) + ' long. You can play it below or press the download button.');
        unbusy(btn);
      }).catch(function (err) {
        setText('sp-status', '');
        setText('sp-error', 'Sorry: ' + err.message);
        unbusy(btn);
      });
    });
  })();

  /* ---------- 6. Remove Sound ---------- */
  (function () {
    var state = wireVideoInput('rs');
    var btn = $('rs-go');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('rs-error', '');
      var lv = state.loaded;
      if (!lv) { setText('rs-error', 'Please choose a video file first.'); unbusy(btn); return; }
      var mime = pickVideoMime(false);
      if (!mime) { setText('rs-error', 'Sorry: your browser cannot record video.'); unbusy(btn); return; }
      setText('rs-status', 'Starting. Making the silent copy happens in real time.');
      playRecord({
        video: lv.video, seconds: lv.duration, offsetSec: 0, rate: 1,
        mime: mime, withAudio: false, statusId: 'rs-status', label: 'Removing sound.'
      }).then(function (blob) {
        $('rs-video').src = URL.createObjectURL(blob);
        wireDownload('rs-dl', blob, baseName(state.file) + '-silent.' + extOf(mime));
        show('rs-result');
        setText('rs-status', 'Done. Your silent video is ' + fmtBytes(blob.size) +
          '. You can play it below or press the download button.');
        unbusy(btn);
      }).catch(function (err) {
        setText('rs-status', '');
        setText('rs-error', 'Sorry: ' + err.message);
        unbusy(btn);
      });
    });
  })();

  /* ---------- 7. Merge Videos ---------- */
  (function () {
    var inp = $('mg-file');
    if (!inp) return;
    var loaded = [];
    inp.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inp.files || []);
      setText('mg-error', '');
      loaded = [];
      $('mg-controls').hidden = true;
      if (files.length < 2) { setText('mg-info', files.length ? 'Please choose at least two videos.' : ''); return; }
      if (files.length > 4) { setText('mg-error', 'Please choose at most four videos at a time.'); return; }
      setText('mg-info', 'Reading ' + files.length + ' videos...');
      Promise.all(files.map(loadVideo)).then(function (lvs) {
        loaded = lvs.map(function (lv, i) { lv.__file = files[i]; return lv; });
        var w0 = lvs[0].w, h0 = lvs[0].h;
        for (var i = 1; i < lvs.length; i++) {
          if (Math.abs(lvs[i].w - w0) > 4 || Math.abs(lvs[i].h - h0) > 4) {
            setText('mg-info', '');
            setText('mg-error', 'Sorry: ' + files[i].name + ' is ' + lvs[i].w + ' by ' + lvs[i].h +
              ' but ' + files[0].name + ' is ' + w0 + ' by ' + h0 +
              '. Please join videos with the same width and height.');
            return;
          }
        }
        var ol = $('mg-list');
        ol.innerHTML = '';
        files.forEach(function (f, i) {
          var li = document.createElement('li');
          li.textContent = f.name + ' (' + fmtTime(lvs[i].duration) + ')';
          ol.appendChild(li);
        });
        var total = lvs.reduce(function (a, lv) { return a + lv.duration; }, 0);
        setText('mg-info', 'Ready to join ' + files.length + ' videos into one ' + fmtTime(total) + ' video, in the order shown.');
        $('mg-controls').hidden = false;
      }).catch(function (err) {
        setText('mg-info', '');
        setText('mg-error', 'Sorry: ' + err.message);
      });
    });
    var btn = $('mg-go');
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('mg-error', '');
      if (loaded.length < 2) { setText('mg-error', 'Please choose at least two videos first.'); unbusy(btn); return; }
      var mime = pickVideoMime(false);
      if (!mime) { setText('mg-error', 'Sorry: your browser cannot record video.'); unbusy(btn); return; }
      var canvas = document.createElement('canvas');
      canvas.width = loaded[0].w; canvas.height = loaded[0].h;
      var g2d = canvas.getContext('2d');
      g2d.fillStyle = '#000'; g2d.fillRect(0, 0, canvas.width, canvas.height);
      var g = getAudioGraph();
      var vstream = canvas.captureStream(30);
      var stream = new MediaStream(vstream.getVideoTracks().concat(g.dest.stream.getAudioTracks()));
      var rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 96000 }); }
      catch (e) { setText('mg-error', 'Sorry: your browser could not start a video recorder.'); unbusy(btn); return; }
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var total = loaded.reduce(function (a, lv) { return a + lv.duration; }, 0);
      var idx = 0;
      rec.start(250);
      function playNext() {
        if (idx >= loaded.length) {
          setTimeout(function () {
            rec.onstop = function () {
              stream.getTracks().forEach(function (t) { t.stop(); });
              var blob = new Blob(chunks, { type: mime.split(';')[0] });
              $('mg-video').src = URL.createObjectURL(blob);
              wireDownload('mg-dl', blob, 'joined-video.' + extOf(mime));
              show('mg-result');
              setText('mg-status', 'Done. Your joined video is ' + fmtTime(total) + ' long and ' +
                fmtBytes(blob.size) + '. You can play it below or press the download button.');
              unbusy(btn);
            };
            rec.stop();
          }, 350);
          return;
        }
        var lv = loaded[idx];
        var n = idx + 1;
        setText('mg-status', 'Joining. Playing part ' + n + ' of ' + loaded.length +
          ' (' + fmtTime(total) + ' in total). Please keep this page open.');
        var srcNode = null;
        try { srcNode = g.ctx.createMediaElementSource(lv.video); srcNode.connect(g.dest); } catch (e) {}
        lv.video.currentTime = 0;
        once(lv.video, 'seeked').then(function () {
          return lv.video.play();
        }).then(function () {
          var draw = function () {
            g2d.drawImage(lv.video, 0, 0, canvas.width, canvas.height);
            if (!lv.video.paused && !lv.video.ended) requestAnimationFrame(draw);
          };
          draw();
          var iv = setInterval(function () {
            if (lv.video.ended || lv.video.currentTime >= lv.duration - 0.08) {
              clearInterval(iv);
              lv.video.pause();
              if (srcNode) { try { srcNode.disconnect(); } catch (e) {} }
              idx++;
              playNext();
            }
          }, 300);
        }).catch(function () {
          setText('mg-status', '');
          setText('mg-error', 'Sorry: your browser refused to play one of the videos.');
          try { rec.stop(); } catch (e) {}
          unbusy(btn);
        });
      }
      playNext();
    });
  })();

  /* ---------- 8. Slideshow Creator ---------- */
  (function () {
    var photosInp = $('ss-photos');
    if (!photosInp) return;
    var audioInp = $('ss-audio');
    var images = [], music = null;
    function refresh() {
      var ok = images.length > 0;
      setText('ss-info', ok ? 'Loaded ' + images.length + (images.length === 1 ? ' photo' : ' photos') +
        (music ? ' and a sound file (' + music.name + ')' : '') + '.' : '');
      $('ss-controls').hidden = !ok;
    }
    photosInp.addEventListener('change', function () {
      var files = Array.prototype.slice.call(photosInp.files || []);
      setText('ss-error', '');
      images = [];
      if (!files.length) { refresh(); return; }
      setText('ss-info', 'Reading ' + files.length + ' photos...');
      Promise.all(files.map(function (f) {
        return createImageBitmap(f).catch(function () { throw new Error('could not read ' + f.name); });
      })).then(function (bitmaps) {
        images = bitmaps;
        refresh();
      }).catch(function (err) {
        setText('ss-info', '');
        setText('ss-error', 'Sorry: your browser ' + err.message + '. JPG and PNG photos work best.');
        refresh();
      });
    });
    audioInp.addEventListener('change', function () {
      music = audioInp.files && audioInp.files[0] || null;
      setText('ss-error', '');
      refresh();
    });
    var btn = $('ss-go');
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('ss-error', '');
      if (!images.length) { setText('ss-error', 'Please choose one or more photos first.'); unbusy(btn); return; }
      var secs = parseFloat($('ss-seconds').value);
      if (!(secs >= 1 && secs <= 30)) { setText('ss-error', 'Please type between 1 and 30 seconds per photo.'); unbusy(btn); return; }
      var width = parseInt($('ss-width').value, 10);
      var height = Math.round(width * 9 / 16);
      var mime = pickVideoMime(false);
      if (!mime) { setText('ss-error', 'Sorry: your browser cannot record video.'); unbusy(btn); return; }
      var total = images.length * secs;
      var canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      var g2d = canvas.getContext('2d');
      g2d.fillStyle = '#000'; g2d.fillRect(0, 0, width, height);
      var g = getAudioGraph();
      var vstream = canvas.captureStream(30);
      var tracks = vstream.getVideoTracks().slice();
      var musicSrc = null;
      function startMusic() {
        if (!music) return Promise.resolve();
        return music.arrayBuffer().then(function (ab) { return g.ctx.decodeAudioData(ab); })
          .then(function (buf) {
            musicSrc = g.ctx.createBufferSource();
            musicSrc.buffer = buf;
            musicSrc.loop = true;
            musicSrc.connect(g.dest);
            tracks = tracks.concat(g.dest.stream.getAudioTracks());
          }).catch(function () {
            setText('ss-status', 'The sound file could not be read, so the slideshow will be silent. Still working.');
          });
      }
      startMusic().then(function () {
        var stream = new MediaStream(tracks);
        var rec;
        try { rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 96000 }); }
        catch (e) { setText('ss-error', 'Sorry: your browser could not start a video recorder.'); unbusy(btn); return; }
        var chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        function drawPhoto(i) {
          var bmp = images[i];
          var scale = Math.min(width / bmp.width, height / bmp.height);
          var w = bmp.width * scale, h = bmp.height * scale;
          g2d.fillStyle = '#000'; g2d.fillRect(0, 0, width, height);
          g2d.drawImage(bmp, (width - w) / 2, (height - h) / 2, w, h);
        }
        rec.start(250);
        if (musicSrc) musicSrc.start();
        drawPhoto(0);
        var t0 = performance.now();
        var cur = 0;
        var iv = setInterval(function () {
          var el = (performance.now() - t0) / 1000;
          var should = Math.min(images.length - 1, Math.floor(el / secs));
          if (should !== cur) { cur = should; drawPhoto(cur); }
          setText('ss-status', 'Making the slideshow. About ' + fmtTime(Math.min(el, total)) + ' of ' +
            fmtTime(total) + ' done. Please keep this page open.');
          if (el >= total) {
            clearInterval(iv);
            setTimeout(function () {
              if (musicSrc) { try { musicSrc.stop(); } catch (e) {} }
              rec.onstop = function () {
                stream.getTracks().forEach(function (t) { t.stop(); });
                var blob = new Blob(chunks, { type: mime.split(';')[0] });
                $('ss-video').src = URL.createObjectURL(blob);
                wireDownload('ss-dl', blob, 'my-slideshow.' + extOf(mime));
                show('ss-result');
                setText('ss-status', 'Done. Your slideshow is ' + fmtTime(total) + ' long and ' +
                  fmtBytes(blob.size) + '. You can play it below or press the download button.');
                unbusy(btn);
              };
              rec.stop();
            }, 350);
          }
        }, 300);
      });
    });
  })();

  /* ---------- 9. Take a Photo from a Video ---------- */
  (function () {
    var state = wireVideoInput('fp');
    var btn = $('fp-go');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (guardBusy(btn)) return;
      setText('fp-error', '');
      var lv = state.loaded;
      if (!lv) { setText('fp-error', 'Please choose a video file first.'); unbusy(btn); return; }
      var sec = parseFloat($('fp-second').value);
      if (!(sec >= 0)) { setText('fp-error', 'Please type a second, zero or more.'); unbusy(btn); return; }
      if (sec > lv.duration) {
        setText('fp-error', 'This video is only ' + fmtTime(lv.duration) + ' long; type a smaller second.');
        unbusy(btn); return;
      }
      var fmt = $('fp-format').value === 'jpeg' ? 'image/jpeg' : 'image/png';
      setText('fp-status', 'Taking the photo at ' + sec + ' seconds...');
      lv.video.currentTime = sec;
      once(lv.video, 'seeked').then(function () {
        /* draw after a paint so the frame is real */
        return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      }).then(function () {
        var canvas = $('fp-canvas');
        canvas.width = lv.video.videoWidth;
        canvas.height = lv.video.videoHeight;
        canvas.getContext('2d').drawImage(lv.video, 0, 0);
        return new Promise(function (r) { canvas.toBlob(r, fmt, 0.92); });
      }).then(function (blob) {
        if (!blob) throw new Error('the photo could not be made');
        wireDownload('fp-dl', blob, baseName(state.file) + '-at-' + sec + 's.' + (fmt === 'image/jpeg' ? 'jpg' : 'png'));
        show('fp-result');
        setText('fp-status', 'Done. The photo from second ' + sec + ' is shown below (' + fmtBytes(blob.size) +
          '). Press the download button to save it.');
        unbusy(btn);
      }).catch(function (err) {
        setText('fp-status', '');
        setText('fp-error', 'Sorry: ' + err.message);
        unbusy(btn);
      });
    });
  })();

})();
