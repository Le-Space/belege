// The English entry (issue #343): opens the app in English unless this
// browser already chose a language. A file, not inline, so the page's
// Content-Security-Policy needs no exception for it.
try {
	if (!localStorage.getItem('belege.locale')) localStorage.setItem('belege.locale', 'en');
} catch {
	// Storage is blocked: the app opens in the browser's language.
}
location.replace('../');
