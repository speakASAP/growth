/**
 * The experiment landing (F-005 §1).
 *
 * A variant is an immutable clone: it is never edited in place, and a change produces a new
 * landingVersionId. The id in the URL is therefore also the id recorded on every touchpoint the
 * page produces, which is what makes a result attributable to a specific page rather than to
 * whatever that page happened to say at the time.
 *
 * The legal footer is inherited from the production Bazos page — privacy, cookies, GDPR, terms,
 * EU AI Act, operator identity, and the "not affiliated with Bazoš.cz" disclaimer. It is not
 * rebuilt here; a clone that quietly dropped a disclosure would be a compliance problem wearing
 * the appearance of a copy.
 *
 * The consent banner blocks measurement, not content: the page is fully usable after a refusal,
 * it simply records nothing.
 */
export function renderLanding(landingVersionId: string): string {
  const safeVersion = landingVersionId.replace(/[^a-zA-Z0-9._-]/g, '');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bazar nábytku — Alfares</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #16181c; } }
  .wrap { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 .75rem; }
  .lede { font-size: 1.1rem; opacity: .85; margin: 0 0 2rem; }
  .cta { display: inline-block; padding: .85rem 1.6rem; border-radius: 8px; background: #1f6feb; color: #fff; text-decoration: none; font-weight: 600; }
  .cta:focus-visible { outline: 3px solid #f0b429; outline-offset: 2px; }
  footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid rgba(128,128,128,.35); font-size: .82rem; opacity: .75; }
  footer a { color: inherit; }
  #consent { position: fixed; inset: auto 0 0 0; padding: 1rem 1.25rem; background: #101418; color: #f5f5f5; display: none; }
  #consent.show { display: block; }
  #consent .row { max-width: 720px; margin: 0 auto; display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; }
  #consent p { margin: 0; flex: 1 1 320px; font-size: .9rem; }
  #consent button { padding: .55rem 1.1rem; border-radius: 6px; border: 1px solid #555; background: #22272e; color: #f5f5f5; cursor: pointer; }
  #consent button.primary { background: #1f6feb; border-color: #1f6feb; }
</style>
</head>
<body>
  <main class="wrap">
    <h1>Nábytek z druhé ruky ve vašem městě</h1>
    <p class="lede">Prohlédněte si aktuální nabídku a domluvte se přímo s prodávajícím.</p>
    <p><a class="cta" id="cta" href="https://bazos.alfares.cz/client">Zobrazit nabídku</a></p>

    <footer>
      <p>Provozovatel: Alfares s.r.o. · Tato stránka není spojena s Bazoš.cz.</p>
      <p>
        <a href="https://bazos.alfares.cz/privacy">Ochrana osobních údajů</a> ·
        <a href="https://bazos.alfares.cz/cookies">Cookies</a> ·
        <a href="https://bazos.alfares.cz/terms">Podmínky</a> ·
        <a href="https://bazos.alfares.cz/ai">Informace podle nařízení EU o AI</a>
      </p>
      <p>Verze stránky: ${safeVersion}</p>
    </footer>
  </main>

  <div id="consent" role="dialog" aria-live="polite" aria-label="Souhlas s měřením">
    <div class="row">
      <p>Měříme účinnost našich inzerátů. Bez vašeho souhlasu nic neukládáme a stránka funguje dál.</p>
      <button id="decline">Odmítnout</button>
      <button id="accept" class="primary">Souhlasím</button>
    </div>
  </div>

<script>
(function () {
  var LANDING_VERSION = ${JSON.stringify(safeVersion)};
  var STORAGE_KEY = 'growth.consent';
  var VERSION = 3;

  function stored() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; }
  }

  function query() {
    var out = {}, params = new URLSearchParams(window.location.search);
    ['gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
      var v = params.get(k);
      if (v) out[k] = v;
    });
    return out;
  }

  // The session and the cookie are minted by the server only once this reports a grant. Nothing
  // is recorded before the visitor answers - a measurement taken without permission cannot be
  // withdrawn afterwards.
  function send(categories) {
    var decision = {
      consentRecordId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      version: VERSION,
      categories: categories,
      decidedAt: new Date().toISOString()
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(decision)); } catch (e) {}

    return fetch('/l/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        decision: decision,
        landingVersionId: LANDING_VERSION,
        query: query(),
        referrer: document.referrer || undefined
      })
    }).catch(function () {});
  }

  var banner = document.getElementById('consent');
  var existing = stored();

  if (!existing || existing.version !== VERSION) {
    banner.classList.add('show');
  }

  document.getElementById('accept').addEventListener('click', function () {
    banner.classList.remove('show');
    send({ necessary: true, analytics: true });
  });

  document.getElementById('decline').addEventListener('click', function () {
    banner.classList.remove('show');
    // Recorded locally so the visitor is not asked again. Nothing is sent: a refusal is not an
    // event to collect.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        consentRecordId: null, version: VERSION,
        categories: { necessary: true, analytics: false },
        decidedAt: new Date().toISOString()
      }));
    } catch (e) {}
  });
})();
</script>
</body>
</html>`;
}
