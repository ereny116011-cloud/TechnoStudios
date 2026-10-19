// TechnoStudios — yasal/iletişim sayfaları ortak davranışı
(function () {
    try {
        if (localStorage.getItem('ts-theme') === 'light') {
            document.body.classList.add('light');
        }
    } catch (e) { /* localStorage kapalı olabilir */ }

    window.toggleTsTheme = function (btn) {
        document.body.classList.toggle('light');
        var isLight = document.body.classList.contains('light');
        try { localStorage.setItem('ts-theme', isLight ? 'light' : 'dark'); } catch (e) {}
        if (btn) btn.textContent = isLight ? 'Koyu tema' : 'Açık tema';
    };

    document.addEventListener('DOMContentLoaded', function () {
        var y = document.getElementById('ts-year');
        if (y) y.textContent = String(new Date().getFullYear());
        var btn = document.getElementById('ts-theme-btn');
        if (btn) btn.textContent = document.body.classList.contains('light') ? 'Koyu tema' : 'Açık tema';
    });
})();
