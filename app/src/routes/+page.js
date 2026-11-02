// The start page is written out at build time (an empty shell: nothing renders
// on the server, see +layout.js). A prerendered page gets relative asset paths
// (`./_app/…`) and computes its base from its own address, so the build opens
// from any path – a path-style IPFS gateway (…/ipfs/<cid>/) as well as the
// domain or a subdomain gateway. adapter-static's SPA fallback (200.html) is
// the one page SvelteKit cannot do that for, as it is served at every depth.
export const prerender = true;
