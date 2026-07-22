import { LandingVariant, LAUNCH_OFFER } from './variants';

/**
 * The experiment landing (F-005 §1).
 *
 * One template, many variants. The copy lives in `variants.ts` as data so that adding a variant
 * is adding a record, not editing a page — and so the id a touchpoint records is provably the id
 * whose words the visitor read.
 *
 * The legal footer is not optional and not variant-specific: privacy, cookies, terms, the EU AI
 * Act notice, operator identity, and the "not affiliated with Bazoš.cz" disclaimer. A variant that
 * dropped one would be a compliance problem wearing the appearance of a copy test.
 */
export function renderLanding(variant: LandingVariant): string {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(variant.title)}</title>
<meta name="description" content="${esc(variant.lede)}">
<!-- An experiment variant must never compete with the real site in search results. -->
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: light dark; --fg:#16181d; --bg:#fff; --muted:#5b6270; --line:#e3e6ea; --accent:#1f6feb; --accent-fg:#fff; --card:#f7f8fa; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8eaed; --bg:#15171b; --muted:#a2a9b5; --line:#2a2f37; --card:#1c1f25; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--fg); background:var(--bg); }
  .wrap { max-width:680px; margin:0 auto; padding:2.5rem 1.25rem 3rem; }
  header .brand { font-weight:700; letter-spacing:.02em; margin:0 0 2.5rem; }
  h1 { font-size:2.1rem; line-height:1.18; margin:0 0 .85rem; letter-spacing:-.01em; }
  .lede { font-size:1.13rem; color:var(--muted); margin:0 0 1.75rem; }
  ul.points { list-style:none; padding:0; margin:0 0 2rem; }
  ul.points li { position:relative; padding:.35rem 0 .35rem 1.85rem; }
  ul.points li::before { content:"✓"; position:absolute; left:0; top:.35rem; color:var(--accent); font-weight:700; }
  .cta { display:inline-block; padding:.95rem 1.9rem; border-radius:10px; background:var(--accent); color:var(--accent-fg); text-decoration:none; font-weight:650; font-size:1.05rem; border:0; cursor:pointer; }
  .cta:focus-visible { outline:3px solid #f0b429; outline-offset:3px; }
  .cta-note { margin:.7rem 0 0; font-size:.9rem; color:var(--muted); }
  .offer { margin:1.5rem 0 0; padding:1.25rem 1.4rem; border:2px solid var(--accent); border-radius:12px; background:var(--card); }
  .offer h2 { margin:0 0 .5rem; font-size:1.25rem; }
  .offer p { margin:0 0 1rem; }
  .rules { margin:2.5rem 0 0; padding:1.1rem 1.25rem; background:var(--card); border:1px solid var(--line); border-radius:10px; font-size:.92rem; color:var(--muted); }
  .rules strong { color:var(--fg); }
  footer { margin-top:2.5rem; padding-top:1.25rem; border-top:1px solid var(--line); font-size:.82rem; color:var(--muted); }
  footer a { color:inherit; }
  footer p { margin:.35rem 0; }
  #consent { position:fixed; inset:auto 0 0 0; padding:1rem 1.25rem; background:#101418; color:#f5f5f5; display:none; box-shadow:0 -6px 24px rgba(0,0,0,.25); }
  #consent.show { display:block; }
  #consent .row { max-width:680px; margin:0 auto; display:flex; gap:.75rem; flex-wrap:wrap; align-items:center; }
  #consent p { margin:0; flex:1 1 300px; font-size:.9rem; }
  #consent button { padding:.6rem 1.2rem; border-radius:7px; border:1px solid #4a5058; background:#22272e; color:#f5f5f5; cursor:pointer; font:inherit; }
  #consent button.primary { background:var(--accent); border-color:var(--accent); font-weight:600; }
</style>
</head>
<body>
  <main class="wrap">
    <header><p class="brand">Alfares · Bazoš</p></header>

    <h1>${esc(variant.h1)}</h1>
    <p class="lede">${esc(variant.lede)}</p>

    <ul class="points">
      ${variant.bullets.map((b) => `<li>${esc(b)}</li>`).join('\n      ')}
    </ul>

    <p><button class="cta" id="cta" type="button">${esc(variant.cta)}</button></p>
    <p class="cta-note">${esc(variant.ctaNote)}</p>

    <!-- Revealed after the priced button is clicked. Nothing is charged and no payment details
         are collected, so the offer is stated as what it is - a launch offer - rather than as a
         prize or as an apology for a payment that never happened. -->
    <section class="offer" id="offer" hidden>
      <h2>${esc(LAUNCH_OFFER.heading)}</h2>
      <p>${esc(LAUNCH_OFFER.body)}</p>
      <p><a class="cta" href="https://bazos.alfares.cz/client">${esc(LAUNCH_OFFER.cta)}</a></p>
    </section>

    <!-- GOAL-06: the landing states the compliance constraints, and states them as constraints.
         Nothing here may read as a way around Bazoš's rules, because there is not one. -->
    <div class="rules">
      <p><strong>Pracujeme v pravidlech Bazoše, ne mimo ně.</strong></p>
      <p>
        Alfares neobchází ověření telefonu, CAPTCHA, limity inzerátů ani jiné kontroly Bazoše.
        Každé telefonní číslo musí být ověřené a patřit vám. Limit aktivních inzerátů a intervaly
        kategorií zůstávají v platnosti — pomáháme je dodržet, ne obejít.
      </p>
    </div>

    <footer>
      <p>Provozovatel: Alfares s.r.o. · Tato stránka ani služba nejsou spojeny s Bazoš.cz.</p>
      <p>
        <a href="https://bazos.alfares.cz/privacy">Ochrana osobních údajů</a> ·
        <a href="https://bazos.alfares.cz/cookies">Cookies</a> ·
        <a href="https://bazos.alfares.cz/terms">Obchodní podmínky</a> ·
        <a href="https://bazos.alfares.cz/ai">Informace podle nařízení EU o AI</a>
      </p>
      <p>Verze stránky: ${esc(variant.id)}</p>
    </footer>
  </main>

  <div id="consent" role="dialog" aria-live="polite" aria-label="Souhlas s měřením">
    <div class="row">
      <p>Měříme účinnost našich inzerátů. Bez vašeho souhlasu nic neukládáme a stránka funguje dál.</p>
      <button id="decline" type="button">Odmítnout</button>
      <button id="accept" class="primary" type="button">Souhlasím</button>
    </div>
  </div>

<script>
(function () {
  var LANDING_VERSION = ${JSON.stringify(variant.id)};
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
      consentRecordId: (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
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
  if (!existing || existing.version !== VERSION) banner.classList.add('show');

  document.getElementById('accept').addEventListener('click', function () {
    banner.classList.remove('show');
    send({ necessary: true, analytics: true });
  });

  // The priced button. It records that someone said yes at this price and then shows the offer.
  // No payment is taken and no payment details are requested - the click is the measurement.
  document.getElementById('cta').addEventListener('click', function () {
    var offer = document.getElementById('offer');
    fetch('/l/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ landingVersionId: LANDING_VERSION })
    }).catch(function () {});

    // Shown regardless of whether the call succeeded. A visitor must never be left staring at a
    // button that did nothing because our analytics was down.
    offer.hidden = false;
    offer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('decline').addEventListener('click', function () {
    banner.classList.remove('show');
    // Remembered locally so the visitor is not asked again. Nothing is sent: a refusal is not an
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

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
