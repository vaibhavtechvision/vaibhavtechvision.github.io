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

  wire('qu', 'upi-qr-code.png', function () {
    var id = $('qu-id').value.trim();
    if (!id) return '';
    if (!/^[\w.\-]{2,}@[a-zA-Z][a-zA-Z0-9]{1,}$/.test(id)) {
      throw new Error('please type a valid UPI ID, for example yourname@okhdfcbank.');
    }
    var out = 'upi://pay?pa=' + encodeURIComponent(id) + '&cu=INR';
    var name = $('qu-name').value.trim();
    if (name) out += '&pn=' + encodeURIComponent(name);
    var amt = $('qu-amount').value.trim();
    if (amt) {
      if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(amt) || parseFloat(amt) <= 0) {
        throw new Error('the amount must be a plain number in rupees, for example 150 or 99.50.');
      }
      out += '&am=' + amt;
    }
    var note = $('qu-note').value.trim();
    if (note) out += '&tn=' + encodeURIComponent(note);
    return out;
  });

  wire('qe', 'email-qr-code.png', function () {
    var to = $('qe-to').value.trim();
    if (!to) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new Error('please type a valid email address, for example name@example.com.');
    }
    var out = 'mailto:' + to;
    var qs = [];
    var sub = $('qe-subject').value.trim();
    if (sub) qs.push('subject=' + encodeURIComponent(sub));
    var body = $('qe-body').value.trim();
    if (body) qs.push('body=' + encodeURIComponent(body));
    if (qs.length) out += '?' + qs.join('&');
    return out;
  });

  wire('qs', 'sms-qr-code.png', function () {
    var n = $('qs-number').value.trim();
    if (!n) return '';
    if (!/^\+?[0-9 ()-]{5,20}$/.test(n)) {
      throw new Error('please type a phone number with digits only, starting with the country code, for example +91.');
    }
    var out = 'sms:' + n.replace(/[ ()-]/g, '');
    var body = $('qs-body').value.trim();
    if (body) out += '?body=' + encodeURIComponent(body);
    return out;
  });

  wire('qc', 'whatsapp-qr-code.png', function () {
    var n = $('qc-number').value.replace(/[^0-9]/g, '');
    if (!n) return '';
    if (n.length < 8 || n.length > 15) {
      throw new Error('please type the number with the country code, using 8 to 15 digits, for example 91 followed by your ten digits.');
    }
    var out = 'https://wa.me/' + n;
    var t = $('qc-text').value.trim();
    if (t) out += '?text=' + encodeURIComponent(t);
    return out;
  });

  wire('qv', 'contact-qr-code.png', function () {
    var name = $('qv-name').value.trim();
    if (!name) return '';
    var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + name.replace(/[\r\n;,]/g, ' ')];
    var phone = $('qv-phone').value.trim();
    if (phone) {
      if (!/^\+?[0-9 ()-]{5,20}$/.test(phone)) {
        throw new Error('the phone number should have digits only, starting with the country code, for example +91.');
      }
      lines.push('TEL;TYPE=CELL:' + phone.replace(/[ ()-]/g, ''));
    }
    var email = $('qv-email').value.trim();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('please type a valid email address, for example name@example.com.');
      }
      lines.push('EMAIL:' + email);
    }
    var org = $('qv-org').value.trim();
    if (org) lines.push('ORG:' + org.replace(/[\r\n;]/g, ' '));
    lines.push('END:VCARD');
    return lines.join('\r\n');
  });

})();
