/* DOCX tools for Vaibhav Tech Vision.
   Reading uses the bundled mammoth library; writing uses html-docx.js.
   Everything runs in the browser; files never leave the device. */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function setText(id, msg) { var el = $(id); if (el) el.textContent = msg; }
  function show(id) { var el = $(id); if (el) el.hidden = false; }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------- DOCX Reader and PDF saver ---------- */
  (function () {
    var inp = $('dr-file');
    if (!inp) return;
    var currentHtml = '';
    var currentName = 'document';

    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      setText('dr-error', '');
      setText('dr-status', '');
      $('dr-result').hidden = true;
      if (!f) return;
      setText('dr-status', 'Reading ' + f.name + '. Please wait.');
      f.arrayBuffer().then(function (ab) {
        return mammoth.convertToHtml({ arrayBuffer: ab });
      }).then(function (result) {
        currentHtml = result.value || '';
        currentName = f.name.replace(/\.docx$/i, '') || 'document';
        var box = $('dr-content');
        box.innerHTML = currentHtml || '<p>(This document looks empty.)</p>';
        var words = (box.textContent || '').trim().split(/\s+/).filter(Boolean).length;
        show('dr-result');
        setText('dr-status', 'Done. ' + f.name + ' is open below, about ' + words +
          ' words. You can read it here, save it as a PDF, or download it as plain text.');
      }).catch(function () {
        setText('dr-status', '');
        setText('dr-error', 'Sorry: this file could not be read. Please choose a Word file ending in .docx.');
      });
    });

    $('dr-pdf').addEventListener('click', function () {
      if (!currentHtml) { setText('dr-error', 'Please choose a document first.'); return; }
      setText('dr-status', 'Opening the print window. In it, choose "Save as PDF" as the printer, then press Save.');
      document.body.classList.add('print-docx');
      setTimeout(function () {
        window.print();
        setTimeout(function () { document.body.classList.remove('print-docx'); }, 1000);
      }, 300);
    });

    $('dr-txt').addEventListener('click', function () {
      if (!currentHtml) { setText('dr-error', 'Please choose a document first.'); return; }
      var text = $('dr-content').innerText;
      download(new Blob([text], { type: 'text/plain;charset=utf-8' }), currentName + '.txt');
      setText('dr-status', 'Done. The plain text file ' + currentName + '.txt has been downloaded.');
    });
  })();

  /* ---------- Text to DOCX ---------- */
  (function () {
    var btn = $('td-go');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      setText('td-status', '');
      var text = $('td-text').value.trim();
      if (!text) {
        setText('td-status', 'Sorry: please type or paste some text first.');
        btn.disabled = false;
        return;
      }
      var name = ($('td-name').value.trim() || 'my-document').replace(/[^A-Za-z0-9 _-]/g, '') || 'my-document';
      setText('td-status', 'Making your Word document...');
      try {
        /* Lines starting with # become headings; blank lines split paragraphs. */
        var blocks = text.split(/\n\s*\n/);
        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
        blocks.forEach(function (block) {
          var lines = block.split('\n');
          var heading = /^#\s+/.test(lines[0]);
          if (heading) {
            html += '<h1>' + esc(lines[0].replace(/^#\s+/, '')) + '</h1>';
            lines = lines.slice(1);
          }
          if (lines.length) html += '<p>' + lines.map(esc).join('<br>') + '</p>';
        });
        html += '</body></html>';
        var blob = window.htmlDocx.asBlob(html);
        download(blob, name + '.docx');
        setText('td-status', 'Done. Your Word document ' + name + '.docx has been downloaded.');
      } catch (err) {
        setText('td-status', 'Sorry: the document could not be made. Please try shorter text.');
      }
      btn.disabled = false;
    });
    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  })();

})();
