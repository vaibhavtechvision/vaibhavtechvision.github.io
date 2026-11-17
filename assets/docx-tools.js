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

    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /* Build a real .docx (WordprocessingML) with the bundled JSZip. */
    function buildDocx(blocks) {
      var body = '';
      blocks.forEach(function (b) {
        var runs = b.lines.map(function (line, i) {
          var br = i > 0 ? '<w:br/>' : '';
          return '<w:r>' + (b.heading ? '<w:rPr><w:b/></w:rPr>' : '') +
            '<w:t xml:space="preserve">' + br + esc(line) + '</w:t></w:r>';
        }).join('');
        var ppr = b.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '';
        body += '<w:p>' + ppr + runs + '</w:p>';
      });
      var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' + body + '<w:sectPr/></w:body></w:document>';
      var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>';
      var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>';
      var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>';
      var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
        '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>' +
        '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
        '</w:styles>';
      var zip = new JSZip();
      zip.file('[Content_Types].xml', contentTypes);
      zip.folder('_rels').file('.rels', rels);
      var word = zip.folder('word');
      word.file('document.xml', documentXml);
      word.file('styles.xml', styles);
      word.folder('_rels').file('document.xml.rels', docRels);
      return zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
    }

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
      /* Blank lines split paragraphs; a line starting with "# " becomes a heading. */
      var blocks = [];
      text.split(/\n\s*\n/).forEach(function (chunk) {
        var lines = chunk.split('\n');
        var heading = /^#\s+/.test(lines[0]);
        if (heading) lines[0] = lines[0].replace(/^#\s+/, '');
        if (lines.join('').trim()) blocks.push({ heading: heading, lines: lines });
      });
      buildDocx(blocks).then(function (blob) {
        download(blob, name + '.docx');
        setText('td-status', 'Done. Your Word document ' + name + '.docx has been downloaded.');
        btn.disabled = false;
      }).catch(function () {
        setText('td-status', 'Sorry: the document could not be made. Please try shorter text.');
        btn.disabled = false;
      });
    });
  })();

})();
