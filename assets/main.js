// Vaibhav Tech Vision - shared menu behaviour
// One "Menu" button reveals the whole menu; section buttons open their
// submenus. Escape closes, and leaving a menu with Tab closes it too.
(function () {
  var toggles = document.querySelectorAll('.menu-toggle, .submenu-toggle');
  toggles.forEach(function (toggle) {
    var submenu = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!submenu) return;

    function open() {
      submenu.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    }
    function close() {
      submenu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    function isOpen() {
      return toggle.getAttribute('aria-expanded') === 'true';
    }

    toggle.addEventListener('click', function () {
      if (isOpen()) { close(); } else { open(); }
    });

    toggle.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) {
        close();
        toggle.focus();
      }
      if (event.key === 'ArrowDown' && !isOpen()) {
        event.preventDefault();
        open();
        var first = submenu.querySelector('a, button');
        if (first) first.focus();
      }
    });

    submenu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        close();
        toggle.focus();
      }
    });

    // Close when focus leaves the menu this button owns
    var wrapper = toggle.closest('li') || toggle.closest('nav');
    wrapper.addEventListener('focusout', function (event) {
      if (!wrapper.contains(event.relatedTarget)) close();
    });

    // Close when clicking anywhere else
    document.addEventListener('click', function (event) {
      if (isOpen() && !wrapper.contains(event.target)) close();
    });
  });
})();

// Tool page sections: every tool starts closed and opens from its heading
// button. Jump links to a section open it first.
(function () {
  var buttons = document.querySelectorAll('.tool-toggle');
  if (!buttons.length) return;
  buttons.forEach(function (button) {
    var body = document.getElementById(button.getAttribute('aria-controls'));
    if (!body) return;
    button.addEventListener('click', function () {
      var open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    });
  });
  function openForHash() {
    if (!location.hash) return;
    var target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    var section = target.closest('.tool-section');
    if (!section) return;
    var button = section.querySelector('.tool-toggle');
    if (button && button.getAttribute('aria-expanded') !== 'true') {
      button.setAttribute('aria-expanded', 'true');
      var body = document.getElementById(button.getAttribute('aria-controls'));
      if (body) body.hidden = false;
    }
  }
  window.addEventListener('hashchange', openForHash);
  openForHash();
})();
