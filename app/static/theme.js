// The theme before the first paint: the stored choice, else the system's.
// A file of its own, not inline in app.html, so the page's Content-Security-Policy
// needs no exception for it.
(function () {
	try {
		var t = localStorage.getItem('belege.theme');
		if (t !== 'light' && t !== 'dark') {
			t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		document.documentElement.classList.toggle('dark', t === 'dark');
		document.documentElement.style.background = t === 'dark' ? '#0B0E15' : '#EDF1F8';
	} catch {
		// Storage is blocked: the stylesheet's own default stays.
	}
})();
