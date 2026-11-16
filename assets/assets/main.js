// Vaibhav Tech Vision - shared menu behaviour
// Accessible dropdown: button toggles submenu, Escape closes, leaving the
// menu with Tab closes it too.
(function () {
  var toggles = document.querySelectorAll('.submenu-toggle');
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
        var first = submenu.querySelector('a');
        if (first) first.focus();
      }
    });

    submenu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        close();
        toggle.focus();
      }
    });

    // Close when focus leaves the whole menu item
    var wrapper = toggle.closest('li');
    wrapper.addEventListener('focusout', function (event) {
      if (!wrapper.contains(event.relatedTarget)) close();
    });

    // Close when clicking anywhere else
    document.addEventListener('click', function (event) {
      if (isOpen() && !wrapper.contains(event.target)) close();
    });
  });
})();
