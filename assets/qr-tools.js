/* QR Code Generator tools for Vaibhav Tech Vision.
   Draws QR codes locally with the bundled qrcode-generator library.
   Nothing is uploaded anywhere. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function setText(id, msg) { var el = $(id); if (el) el.textContent = msg; }
  function show(id) { var el = $(id); if (el) el.hidden = false; }

  /* Draw a QR code onto a canvas. Returns the pixel size used. */
  function drawQr(canvas, text, targetPx) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var cell = Math.max(1, Math.round(targetPx / (n + 8)));
    var size = cell * (n + 8);
    canvas.width = size;
    canvas.height = size;
    var g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) g.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
      }
    }
    return size;
  }

  function wireDownload(btn, canvas, name) {
    btn.__qrCanvas = canvas;
    btn.__qrName = name;
  }
  document.addEventListener('click', function (e) {
    var b = e.target;
    if (b && b.tagName === 'BUTTON' && b.__qrCanvas) {
      b.__qrCanvas.toBlob(function (blob) {
        if (!blob) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = b.__qrName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, 'image/png');
    }
  });

  /* One maker: builds the QR text, draws it, announces the result. */
  function wire(prefix, fileName, buildText) {
    var btn = $(prefix + '-go');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      setText(prefix + '-status', '');
      var built;
      try {
        built = buildText();
      } catch (err) {
        setText(prefix + '-status', 'Sorry: ' + err.message);
        btn.disabled = false;
        return;
      }
      if (!built) {
        setText(prefix + '-status', 'Sorry: please type the information first.');
        btn.disabled = false;
        return;
      }
      var px = parseInt($(prefix + '-size').value, 10) || 400;
      setText(prefix + '-status', 'Making your QR code...');
      try {
        var canvas = $(prefix + '-canvas');
        var size = drawQr(canvas, built, px);
        wireDownload($(prefix + '-dl'), canvas, fileName);
        show(prefix + '-result');
        setText(prefix + '-status', 'Done. Your QR code is ready below, ' + size + ' by ' + size +
          ' pixels. Press the download button to save it as a PNG image.');
      } catch (err) {
        setText(prefix + '-status', 'Sorry: that is too much text for one QR code. Please make it shorter and try again.');
      }
      btn.disabled = false;
    });
  }

  /* Characters with special meaning in Wi-Fi QR text must be escaped. */
  function wifiEscape(s) {
    return s.replace(/([\\;,:"'])/g, '\\$1');
  }

  wire('qt', 'qr-code.png', function () {
    var t = $('qt-text').value.trim();
    if (!t) return '';
    return t;
  });

  wire('qw', 'wifi-qr-code.png', function () {
    var name = $('qw-name').value.trim();
    if (!name) return '';
    var type = $('qw-type').value;
    var pass = $('qw-pass').value;
    if (type !== 'nopass' && !pass) {
      throw new Error('please type the Wi-Fi password, or choose "No password".');
    }
    var out = 'WIFI:T:' + type + ';S:' + wifiEscape(name) + ';';
    if (type !== 'nopass') out += 'P:' + wifiEscape(pass) + ';';
    return out + ';';
  });

  wire('qp', 'phone-qr-code.png', function () {
    var n = $('qp-number').value.trim();
    if (!n) return '';
    if (!/^\+?[0-9 ()-]{5,20}$/.test(n)) {
      throw new Error('please type a phone number with digits only, starting with the country code, for example +91.');
    }
    return 'tel:' + n.replace(/[ ()-]/g, '');
  });

})();
