/* Vaibhav Tech Vision - Audio Editor page engine.
   All processing happens in the browser with the Web Audio API and,
   for the Speed Changer, a WebAssembly audio engine stored on this site.
   No file is ever uploaded anywhere. */
(function () {
  'use strict';

  var RATE = 44100;
  var sharedCtx = null;

  function actx() {
    if (!sharedCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      sharedCtx = new AC();
    }
    return sharedCtx;
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(id, msg) { var el = $(id); if (el) el.textContent = msg; }
  function setError(id, msg) { var el = $(id); if (el) el.textContent = msg; }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec * 10) / 10);
    var m = Math.floor(sec / 60);
    var s = Math.round((sec - m * 60) * 10) / 10;
    if (m === 0) return s + ' seconds';
    return m + ' minutes ' + s + ' seconds';
  }

  function fmtSize(bytes) {
    if (bytes >= 1048576) return (Math.round(bytes / 104857.6) / 10) + ' MB';
    return Math.round(bytes / 102.4) / 10 + ' KB';
  }

  function baseName(name) {
    var i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  /* Read a File into an AudioBuffer. */
  function decodeFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        actx().decodeAudioData(reader.result, resolve, function () {
          reject(new Error('Your browser could not read the sound in this file. Try an MP3, WAV, OGG or M4A file.'));
        });
      };
      reader.onerror = function () { reject(new Error('The file could not be opened.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /* Render a processing graph offline and return the resulting AudioBuffer.
     build(ctx) must create and start its sources and return nothing. */
  function render(seconds, channels, build) {
    var frames = Math.max(1, Math.ceil(seconds * RATE));
    var ctx = new OfflineAudioContext(channels, frames, RATE);
    build(ctx);
    return ctx.startRendering();
  }

  function playBuffer(ctx, buffer, gainValue, when) {
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(when || 0);
    return gain;
  }

  /* Encode an AudioBuffer to a 16-bit WAV Blob. */
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
    var off = 44;
    var chans = [];
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

  /* Encode an AudioBuffer to an MP3 Blob with lamejs. */
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
    for (var i = 0; i < left.length; i += block) {
      var l = left.subarray(i, Math.min(i + block, left.length));
      var data = channels === 2
        ? enc.encodeBuffer(l, right.subarray(i, Math.min(i + block, right.length)))
        : enc.encodeBuffer(l);
      if (data.length) parts.push(new Int8Array(data));
    }
    var end = enc.flush();
    if (end.length) parts.push(new Int8Array(end));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  function encode(buffer, format, kbps) {
    return format === 'wav' ? encodeWav(buffer) : encodeMp3(buffer, kbps);
  }

  /* WebAssembly audio engine (ffmpeg), loaded on first use only. */
  var ffmpegPromise = null;
  function loadEngine(onStatus) {
    if (!ffmpegPromise) {
      onStatus('Downloading the audio engine (about 30 MB). This happens only once; please wait.');
      var ff = FFmpeg.createFFmpeg({ log: false, corePath: '../assets/lib/ffmpeg/ffmpeg-core.js' });
      ffmpegPromise = ff.load().then(function () { return ff; });
    }
    return ffmpegPromise;
  }

  function atempoChain(rate) {
    var parts = [];
    var r = rate;
    while (r > 2) { parts.push('atempo=2.0'); r = r / 2; }
    while (r < 0.5) { parts.push('atempo=0.5'); r = r / 0.5; }
    parts.push('atempo=' + (Math.round(r * 1000) / 1000));
    return parts.join(',');
  }

  /* Change tempo with the engine, keeping pitch natural. Returns a Blob. */
  function engineTempo(file, rate, format, onStatus) {
    return loadEngine(onStatus).then(function (ff) {
      onStatus('Changing the speed. Long files can take a few minutes; please wait.');
      var ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.mp3'])[0].toLowerCase();
      var inName = 'vtv-in' + ext;
      var outName = format === 'wav' ? 'vtv-out.wav' : 'vtv-out.mp3';
      return FFmpeg.fetchFile(file).then(function (data) {
        ff.FS('writeFile', inName, data);
        var args = ['-i', inName, '-filter:a', atempoChain(rate)];
        if (format === 'wav') args.push('-acodec', 'pcm_s16le');
        else args.push('-codec:a', 'libmp3lame', '-b:a', '128k');
        args.push('-y', outName);
        return ff.run.apply(ff, args).then(function () {
          var out = ff.FS('readFile', outName);
          try { ff.FS('unlink', inName); ff.FS('unlink', outName); } catch (e) {}
          return new Blob([out.buffer], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
        });
      });
    });
  }

  /* Wire a file input: decode on change and announce what was loaded. */
  function wireFile(inputId, infoId, errorId, controlsId, onBuffer) {
    $(inputId).addEventListener('change', function () {
      var file = this.files && this.files[0];
      setError(errorId, '');
      if (!file) { $(controlsId).hidden = true; setStatus(infoId, ''); return; }
      setStatus(infoId, 'Reading ' + file.name + ' (' + fmtSize(file.size) + '). Please wait.');
      decodeFile(file).then(function (buffer) {
        setStatus(infoId, file.name + ' is ready. Length: ' + fmtTime(buffer.duration) + '.');
        $(controlsId).hidden = false;
        onBuffer(buffer, file);
      }).catch(function (err) {
        setStatus(infoId, '');
        $(controlsId).hidden = true;
        setError(errorId, err.message);
      });
    });
  }

  function showResult(boxId, audioId, dlId, statusId, blob, filename, message) {
    var url = URL.createObjectURL(blob);
    var box = $(boxId);
    $(audioId).src = url;
    box.hidden = false;
    var dl = $(dlId);
    dl.onclick = function () {
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    setStatus(statusId, message + ' The new file is ' + fmtSize(blob.size) + ' and is ' + fmtTime(blob._dur || 0) + ' long. You can listen to it below, or press the download button.');
  }

  function num(id, fallback) {
    var v = parseFloat($(id).value);
    return isNaN(v) ? fallback : v;
  }

  /* ---------- 1. Audio Trimmer ---------- */
  (function () {
    var buffer = null, fileName = 'audio';
    wireFile('tr-file', 'tr-info', 'tr-error', 'tr-controls', function (b, f) {
      buffer = b; fileName = baseName(f.name);
      $('tr-end').value = Math.round(b.duration * 10) / 10;
    });
    $('tr-go').addEventListener('click', function () {
      if (!buffer) return;
      var start = num('tr-start', 0), end = num('tr-end', buffer.duration);
      var dur = buffer.duration;
      if (start < 0 || end <= start || start >= dur) {
        setError('tr-error', 'Please check the times: start must be smaller than end, and both inside the recording length of ' + fmtTime(dur) + '.');
        return;
      }
      setError('tr-error', '');
      end = Math.min(end, dur);
      var mode = document.querySelector('input[name="tr-mode"]:checked').value;
      var format = $('tr-format').value;
      setStatus('tr-status', 'Trimming. Please wait.');
      var keepDur = mode === 'keep' ? (end - start) : (start + (dur - end));
      render(keepDur, buffer.numberOfChannels, function (ctx) {
        if (mode === 'keep') {
          var src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.start(0, start, end - start);
        } else {
          if (start > 0.01) {
            var s1 = ctx.createBufferSource(); s1.buffer = buffer;
            s1.connect(ctx.destination); s1.start(0, 0, start);
          }
          if (end < dur - 0.01) {
            var s2 = ctx.createBufferSource(); s2.buffer = buffer;
            s2.connect(ctx.destination); s2.start(start, end, dur - end);
          }
        }
      }).then(function (out) {
        var blob = encode(out, format, 128);
        blob._dur = out.duration;
        showResult('tr-result', 'tr-audio', 'tr-dl', 'tr-status', blob,
          fileName + '.trimmed.' + format,
          mode === 'keep' ? 'Done. I kept the part from ' + start + ' to ' + Math.round(end * 10) / 10 + ' seconds.'
                          : 'Done. I removed the part from ' + start + ' to ' + Math.round(end * 10) / 10 + ' seconds.');
      }).catch(function () { setStatus('tr-status', 'Sorry, trimming failed. Try a smaller part or a different file.'); });
    });
  })();

  /* ---------- 2. Audio Merger ---------- */
  (function () {
    var items = []; /* {file, buffer, name} */
    function renderList() {
      var ol = $('mg-list');
      ol.innerHTML = '';
      items.forEach(function (item, idx) {
        var li = document.createElement('li');
        var label = document.createElement('span');
        label.textContent = item.name + ' (' + fmtTime(item.buffer.duration) + ') ';
        li.appendChild(label);
        var up = document.createElement('button');
        up.type = 'button'; up.className = 'action secondary';
        up.textContent = 'Move up';
        up.setAttribute('aria-label', 'Move ' + item.name + ' up');
        up.disabled = idx === 0;
        up.addEventListener('click', function () {
          var t = items[idx - 1]; items[idx - 1] = items[idx]; items[idx] = t;
          renderList();
          setStatus('mg-status', item.name + ' moved up. It is now number ' + idx + ' in the list.');
        });
        var down = document.createElement('button');
        down.type = 'button'; down.className = 'action secondary';
        down.textContent = 'Move down';
        down.setAttribute('aria-label', 'Move ' + item.name + ' down');
        down.disabled = idx === items.length - 1;
        down.addEventListener('click', function () {
          var t = items[idx + 1]; items[idx + 1] = items[idx]; items[idx] = t;
          renderList();
          setStatus('mg-status', item.name + ' moved down. It is now number ' + (idx + 2) + ' in the list.');
        });
        li.appendChild(up); li.appendChild(down);
        ol.appendChild(li);
      });
    }
    $('mg-file').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      setError('mg-error', '');
      items = [];
      $('mg-controls').hidden = true;
      if (!files.length) { setStatus('mg-info', ''); return; }
      if (files.length < 2) { setError('mg-error', 'Please choose at least two audio files to join.'); setStatus('mg-info', ''); return; }
      setStatus('mg-info', 'Reading ' + files.length + ' files. Please wait.');
      Promise.all(files.map(decodeFile)).then(function (buffers) {
        items = files.map(function (f, i) { return { file: f, buffer: buffers[i], name: f.name }; });
        setStatus('mg-info', files.length + ' files are ready. Their total length is ' + fmtTime(buffers.reduce(function (a, b) { return a + b.duration; }, 0)) + '.');
        $('mg-controls').hidden = false;
        renderList();
      }).catch(function (err) { setStatus('mg-info', ''); setError('mg-error', err.message); });
    });
    $('mg-go').addEventListener('click', function () {
      if (items.length < 2) return;
      var gap = num('mg-gap', 0);
      var format = $('mg-format').value;
      setStatus('mg-status', 'Joining the files. Please wait.');
      var total = items.reduce(function (a, it) { return a + it.buffer.duration; }, 0) + gap * (items.length - 1);
      var chans = items.some(function (it) { return it.buffer.numberOfChannels > 1; }) ? 2 : 1;
      render(total, chans, function (ctx) {
        var t = 0;
        items.forEach(function (it) {
          playBuffer(ctx, it.buffer, 1, t);
          t += it.buffer.duration + gap;
        });
      }).then(function (out) {
        var blob = encode(out, format, 128);
        blob._dur = out.duration;
        showResult('mg-result', 'mg-audio', 'mg-dl', 'mg-status', blob,
          'joined-audio.' + format,
          'Done. ' + items.length + ' files are now one file.');
      }).catch(function () { setStatus('mg-status', 'Sorry, joining failed. Try fewer or shorter files.'); });
    });
  })();

  /* ---------- 3. Audio Converter ---------- */
  (function () {
    var buffer = null, fileName = 'audio';
    wireFile('cv-file', 'cv-info', 'cv-error', 'cv-controls', function (b, f) { buffer = b; fileName = baseName(f.name); });
    $('cv-format').addEventListener('change', function () {
      $('cv-quality-box').hidden = this.value !== 'mp3';
    });
    $('cv-go').addEventListener('click', function () {
      if (!buffer) return;
      var format = $('cv-format').value;
      var kbps = parseInt($('cv-bitrate').value, 10) || 128;
      setStatus('cv-status', 'Converting. Long files can take a minute; please wait.');
      setTimeout(function () {
        try {
          var blob = encode(buffer, format, kbps);
          blob._dur = buffer.duration;
          showResult('cv-result', 'cv-audio', 'cv-dl', 'cv-status', blob,
            fileName + '.' + format, 'Done. Your file was converted to ' + format.toUpperCase() + '.');
        } catch (e) {
          setStatus('cv-status', 'Sorry, the conversion failed. Try a different file.');
        }
      }, 30);
    });
  })();

  /* ---------- 4. Volume Changer ---------- */
  (function () {
    var buffer = null, fileName = 'audio';
    wireFile('vl-file', 'vl-info', 'vl-error', 'vl-controls', function (b, f) { buffer = b; fileName = baseName(f.name); });
    $('vl-go').addEventListener('click', function () {
      if (!buffer) return;
      var format = $('vl-format').value;
      var gain = num('vl-percent', 100) / 100;
      if ($('vl-max').checked) {
        var peak = 0;
        for (var c = 0; c < buffer.numberOfChannels; c++) {
          var d = buffer.getChannelData(c);
          for (var i = 0; i < d.length; i += 7) { var a = Math.abs(d[i]); if (a > peak) peak = a; }
        }
        gain = peak > 0 ? 0.98 / peak : 1;
      }
      setStatus('vl-status', 'Changing the volume. Please wait.');
      render(buffer.duration, buffer.numberOfChannels, function (ctx) {
        playBuffer(ctx, buffer, gain, 0);
      }).then(function (out) {
        var blob = encode(out, format, 128);
        blob._dur = out.duration;
        showResult('vl-result', 'vl-audio', 'vl-dl', 'vl-status', blob,
          fileName + '.volume.' + format, 'Done. The volume was changed.');
      }).catch(function () { setStatus('vl-status', 'Sorry, it failed. Try a shorter file.'); });
    });
  })();

  /* ---------- 5. Speed Changer ---------- */
  (function () {
    var file = null, fileName = 'audio';
    $('sp-file').addEventListener('change', function () {
      file = this.files && this.files[0];
      setError('sp-error', '');
      if (!file) { $('sp-controls').hidden = true; setStatus('sp-info', ''); return; }
      fileName = baseName(file.name);
      setStatus('sp-info', file.name + ' (' + fmtSize(file.size) + ') is ready.');
      $('sp-controls').hidden = false;
    });
    $('sp-go').addEventListener('click', function () {
      if (!file) return;
      var pct = num('sp-percent', 100);
      if (pct < 25 || pct > 400) { setError('sp-error', 'Speed must be between 25 and 400 percent.'); return; }
      setError('sp-error', '');
      var format = $('sp-format').value;
      setStatus('sp-status', 'Starting. Please wait.');
      engineTempo(file, pct / 100, format, function (m) { setStatus('sp-status', m); })
        .then(function (blob) {
          var audio = $('sp-audio');
          audio.src = URL.createObjectURL(blob);
          audio.addEventListener('loadedmetadata', function once() {
            audio.removeEventListener('loadedmetadata', once);
            blob._dur = audio.duration;
            showResult('sp-result', 'sp-audio', 'sp-dl', 'sp-status', blob,
              fileName + '.' + pct + '-percent-speed.' + format,
              'Done. The recording now plays at ' + pct + ' percent speed.');
          }, { once: true });
          $('sp-result').hidden = false;
          setStatus('sp-status', 'Done. The recording now plays at ' + pct + ' percent speed. The new file is ' + fmtSize(blob.size) + '.');
          var dl = $('sp-dl');
          dl.onclick = function () {
            var a = document.createElement('a');
            a.href = audio.src; a.download = fileName + '.' + pct + '-percent-speed.' + format;
            document.body.appendChild(a); a.click(); a.remove();
          };
        })
        .catch(function () { setStatus('sp-status', 'Sorry, changing the speed failed. Try a smaller file, or reload the page and try again.'); });
    });
  })();

  /* ---------- 6. Voice Over Mixer ---------- */
  (function () {
    var voice = null, music = null;
    function checkReady() {
      if (voice && music) {
        setStatus('vo-info', 'Both files are ready. Voice: ' + fmtTime(voice.duration) + '. Music: ' + fmtTime(music.duration) + '.');
        $('vo-controls').hidden = false;
      }
    }
    $('vo-voice').addEventListener('change', function () {
      var f = this.files && this.files[0]; setError('vo-error', '');
      if (!f) return;
      setStatus('vo-info', 'Reading the voice recording. Please wait.');
      decodeFile(f).then(function (b) { voice = b; checkReady(); if (!music) setStatus('vo-info', 'Voice recording is ready (' + fmtTime(b.duration) + '). Now choose the music.'); })
        .catch(function (e) { setError('vo-error', e.message); });
    });
    $('vo-music').addEventListener('change', function () {
      var f = this.files && this.files[0]; setError('vo-error', '');
      if (!f) return;
      setStatus('vo-info', 'Reading the music. Please wait.');
      decodeFile(f).then(function (b) { music = b; checkReady(); if (!voice) setStatus('vo-info', 'Music is ready (' + fmtTime(b.duration) + '). Now choose the voice recording.'); })
        .catch(function (e) { setError('vo-error', e.message); });
    });
    $('vo-go').addEventListener('click', function () {
      if (!voice || !music) return;
      var duck = num('vo-duck', 15) / 100;
      var after = num('vo-after', 100) / 100;
      var fade = Math.max(0.1, num('vo-fade', 2));
      var format = $('vo-format').value;
      setStatus('vo-status', 'Mixing your voice over. Please wait.');
      var dur = Math.max(voice.duration, music.duration);
      var chans = (voice.numberOfChannels > 1 || music.numberOfChannels > 1) ? 2 : 1;
      render(dur, chans, function (ctx) {
        var vs = ctx.createBufferSource(); vs.buffer = voice;
        vs.connect(ctx.destination); vs.start(0);
        var ms = ctx.createBufferSource(); ms.buffer = music;
        ms.loop = music.duration < voice.duration;
        var g = ctx.createGain();
        g.gain.setValueAtTime(duck, 0);
        if (dur > voice.duration) {
          g.gain.setValueAtTime(duck, Math.max(0, voice.duration));
          g.gain.linearRampToValueAtTime(after, Math.min(dur, voice.duration + fade));
        }
        if (dur > 2) {
          var holdVal = (dur - 1.5 > voice.duration) ? after : duck;
          g.gain.setValueAtTime(holdVal, Math.max(0, dur - 1.5));
          g.gain.linearRampToValueAtTime(0.0001, dur);
        }
        ms.connect(g); g.connect(ctx.destination);
        ms.start(0);
      }).then(function (out) {
        var blob = encode(out, format, 128);
        blob._dur = out.duration;
        showResult('vo-result', 'vo-audio', 'vo-dl', 'vo-status', blob,
          'voice-over.' + format, 'Done. Your voice over is ready.');
      }).catch(function () { setStatus('vo-status', 'Sorry, the mix failed. Try shorter files.'); });
    });
  })();

  /* ---------- 7. Multi-Track Mixer ---------- */
  (function () {
    var tracks = [];
    $('mx-file').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      setError('mx-error', '');
      tracks = [];
      $('mx-controls').hidden = true;
      if (!files.length) { setStatus('mx-info', ''); return; }
      if (files.length < 2 || files.length > 4) {
        setError('mx-error', 'Please choose between two and four audio files.');
        setStatus('mx-info', '');
        return;
      }
      setStatus('mx-info', 'Reading ' + files.length + ' files. Please wait.');
      Promise.all(files.map(decodeFile)).then(function (buffers) {
        tracks = buffers;
        setStatus('mx-info', files.length + ' files are ready. Set each loudness, then press Mix my tracks.');
        var box = $('mx-tracks');
        box.innerHTML = '';
        files.forEach(function (f, i) {
          var p = document.createElement('p');
          var label = document.createElement('label');
          label.setAttribute('for', 'mx-vol-' + i);
          label.textContent = 'Loudness in percent for ' + f.name + ' (' + fmtTime(buffers[i].duration) + ')';
          var input = document.createElement('input');
          input.type = 'number'; input.id = 'mx-vol-' + i;
          input.min = '0'; input.max = '200'; input.step = '5'; input.value = '100';
          p.appendChild(label); p.appendChild(input);
          box.appendChild(p);
        });
        $('mx-controls').hidden = false;
      }).catch(function (err) { setStatus('mx-info', ''); setError('mx-error', err.message); });
    });
    $('mx-go').addEventListener('click', function () {
      if (tracks.length < 2) return;
      var format = $('mx-format').value;
      setStatus('mx-status', 'Mixing the tracks. Please wait.');
      var dur = Math.max.apply(null, tracks.map(function (b) { return b.duration; }));
      var chans = tracks.some(function (b) { return b.numberOfChannels > 1; }) ? 2 : 1;
      render(dur, chans, function (ctx) {
        tracks.forEach(function (b, i) {
          var v = num('mx-vol-' + i, 100) / 100;
          playBuffer(ctx, b, v, 0);
        });
      }).then(function (out) {
        var blob = encode(out, format, 128);
        blob._dur = out.duration;
        showResult('mx-result', 'mx-audio', 'mx-dl', 'mx-status', blob,
          'mixed-tracks.' + format, 'Done. ' + tracks.length + ' tracks were mixed together.');
      }).catch(function () { setStatus('mx-status', 'Sorry, the mix failed. Try shorter files.'); });
    });
  })();

  /* ---------- 8. Fade In and Fade Out ---------- */
  (function () {
    var buffer = null, fileName = 'audio';
    wireFile('fd-file', 'fd-info', 'fd-error', 'fd-controls', function (b, f) { buffer = b; fileName = baseName(f.name); });
    $('fd-go').addEventListener('click', function () {
      if (!buffer) return;
      var fin = num('fd-in', 0), fout = num('fd-out', 0);
      var format = $('fd-format').value;
      var dur = buffer.duration;
      if (fin + fout >= dur) { setError('fd-error', 'The two fades together must be shorter than the recording (' + fmtTime(dur) + ').'); return; }
      setError('fd-error', '');
      setStatus('fd-status', 'Adding the fades. Please wait.');
      render(dur, buffer.numberOfChannels, function (ctx) {
        var g = playBuffer(ctx, buffer, 1, 0);
        if (fin > 0) {
          g.gain.setValueAtTime(0.0001, 0);
          g.gain.linearRampToValueAtTime(1, fin);
        }
        if (fout > 0) {
          g.gain.setValueAtTime(1, dur - fout);
          g.gain.linearRampToValueAtTime(0.0001, dur);
        }
      }).then(function (out) {
        var blob = encode(out, format, 128);
        blob._dur = out.duration;
        showResult('fd-result', 'fd-audio', 'fd-dl', 'fd-status', blob,
          fileName + '.faded.' + format, 'Done. The fades were added.');
      }).catch(function () { setStatus('fd-status', 'Sorry, it failed. Try a shorter file.'); });
    });
  })();

  /* ---------- 9. Audio Reverser ---------- */
  (function () {
    var buffer = null, fileName = 'audio';
    wireFile('rv-file', 'rv-info', 'rv-error', 'rv-controls', function (b, f) { buffer = b; fileName = baseName(f.name); });
    $('rv-go').addEventListener('click', function () {
      if (!buffer) return;
      var format = $('rv-format').value;
      setStatus('rv-status', 'Reversing. Please wait.');
      setTimeout(function () {
        try {
          var out = actx().createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
          for (var c = 0; c < buffer.numberOfChannels; c++) {
            var src = buffer.getChannelData(c);
            var dst = out.getChannelData(c);
            for (var i = 0, j = src.length - 1; j >= 0; i++, j--) dst[i] = src[j];
          }
          var blob = encode(out, format, 128);
          blob._dur = out.duration;
          showResult('rv-result', 'rv-audio', 'rv-dl', 'rv-status', blob,
            fileName + '.reversed.' + format, 'Done. The recording now plays backwards.');
        } catch (e) {
          setStatus('rv-status', 'Sorry, reversing failed. Try a shorter file.');
        }
      }, 30);
    });
  })();

  /* ---------- 10. Clear Phone Speaker ---------- */
  (function () {
    var osc = null, gain = null, sweepTimer = null, stopTimer = null, leftTimer = null, deadline = 0;
    function stop(msg) {
      if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      if (leftTimer) { clearInterval(leftTimer); leftTimer = null; }
      if (osc) { try { osc.stop(); } catch (e) {} osc.disconnect(); osc = null; }
      if (gain) { gain.disconnect(); gain = null; }
      $('cs-start').disabled = false;
      $('cs-stop').disabled = true;
      setStatus('cs-status', msg);
    }
    $('cs-start').addEventListener('click', function () {
      var seconds = parseInt($('cs-seconds').value, 10) || 30;
      var ctx = actx();
      if (ctx.state === 'suspended') ctx.resume();
      osc = ctx.createOscillator();
      osc.type = 'sine';
      gain = ctx.createGain();
      gain.gain.value = 0.9;
      osc.connect(gain); gain.connect(ctx.destination);
      var t0 = ctx.currentTime;
      osc.frequency.setValueAtTime(60, t0);
      osc.start();
      sweepTimer = setInterval(function () {
        var t = ctx.currentTime;
        osc.frequency.cancelScheduledValues(t);
        osc.frequency.setValueAtTime(60, t);
        osc.frequency.exponentialRampToValueAtTime(8000, t + 0.8);
        osc.frequency.exponentialRampToValueAtTime(60, t + 1.6);
      }, 1600);
      deadline = Date.now() + seconds * 1000;
      $('cs-start').disabled = true;
      $('cs-stop').disabled = false;
      setStatus('cs-status', 'The cleaning sound is playing for ' + seconds + ' seconds. Hold the phone with the speaker facing down. Keep it away from your ear.');
      leftTimer = setInterval(function () {
        var left = Math.ceil((deadline - Date.now()) / 1000);
        if (left > 0) setStatus('cs-status', 'The cleaning sound is playing. ' + left + ' seconds left. Keep the phone speaker facing down, away from your ear.');
      }, 5000);
      stopTimer = setTimeout(function () { stop('Finished. The cleaning sound played for ' + seconds + ' seconds and has stopped.'); }, seconds * 1000);
    });
    $('cs-stop').addEventListener('click', function () { stop('The cleaning sound was stopped.'); });
  })();

})();
