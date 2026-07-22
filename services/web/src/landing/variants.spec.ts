import { findVariant, VARIANTS } from './variants';
import { renderLanding } from './landing.assets';

/**
 * These specs are less about rendering than about what may be said.
 *
 * The page will receive paid traffic under Alfares's name. Two things must hold for every variant
 * and must keep holding when someone adds a fifth: it may not imply that Bazoš's rules are worked
 * around, and it may not read as though the service is free.
 */
describe('every variant is complete', () => {
  it.each(VARIANTS.map((v) => [v.id, v]))('%s has all its copy', (_id, variant) => {
    for (const [field, value] of Object.entries(variant)) {
      if (Array.isArray(value)) {
        expect(value.length).toBeGreaterThan(0);
        value.forEach((line) => expect(line.trim()).not.toBe(''));
      } else {
        expect(String(value).trim()).not.toBe('');
      }
      expect(String(value)).not.toMatch(/TODO|TBD|lorem|placeholder/i);
      expect(field).toBeTruthy();
    }
  });

  it('gives every variant a distinct id', () => {
    // Two variants sharing an id would merge their results into one row and neither would be
    // measurable.
    expect(new Set(VARIANTS.map((v) => v.id)).size).toBe(VARIANTS.length);
  });

  it('offers more than one variant, or there is nothing to compare', () => {
    expect(VARIANTS.length).toBeGreaterThanOrEqual(2);
  });

  it('gives each variant a stated angle, so the result can be read as an answer', () => {
    // Without this the experiment says "v3 won" and nobody remembers what v3 argued.
    VARIANTS.forEach((v) => expect(v.angle.length).toBeGreaterThan(20));
  });
});

describe('what the copy may claim', () => {
  const rendered = VARIANTS.map((v) => [v.id, renderLanding(v)] as const);

  it.each(rendered)('%s only ever mentions bypassing in order to deny it', (_id, html) => {
    // GOAL-06 and BUSINESS.md: the service works within Bazoš's verification, limits and
    // intervals. The page is allowed — encouraged — to say it does *not* bypass them; what it may
    // never do is promise that it does. So every occurrence of the verb must be negated.
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const pattern = /\S*(obcház|obejd|obejít)\S*/gi;
    const found: Array<{ word: string; before: string }> = [];
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      found.push({ word: m[0], before: text.slice(Math.max(0, m.index - 14), m.index) });
    }

    expect(found.length).toBeGreaterThan(0); // the denial itself must be present

    found.forEach(({ word, before }) => {
      // Negated either as a prefix ("neobchází") or as a separate word ("ne obejít", "nikoli
      // obcházet"). Both are ordinary Czech and both are denials; what must never appear is the
      // bare verb as a promise.
      const negated = /^ne/i.test(word) || /\b(ne|nikoli|nikoliv)\s*$/i.test(before);
      expect({ word, before, negated }).toMatchObject({ negated: true });
    });
  });

  it.each(rendered)('%s promises nothing Bazoš forbids', (_id, html) => {
    for (const forbidden of [
      /bez ověřen/i, // "without verification"
      /neomezen/i, // "unlimited" — the active-ad cap is a hard platform limit
      /bez limit/i,
      /automaticky ověř/i, // automating the verification itself
    ]) {
      expect(html).not.toMatch(forbidden);
    }
  });

  it.each(rendered)('%s states the price wherever it says registration is free', (_id, html) => {
    // "Zdarma" beside a paid subscription reads differently to a consumer-protection authority
    // than it does to a marketer. Where the word appears, the 49 Kč must appear too.
    if (/zdarma|nic nestojí/i.test(html)) {
      expect(html).toMatch(/49\s*Kč/);
    }
  });

  it('applies a rule that can actually fail', () => {
    // The rule passes on every real variant because the launch offer states the price, so it
    // could be passing by construction rather than by checking anything. Run the same predicate
    // over text that should fail it.
    const rule = (text: string) => !/zdarma|nic nestojí/i.test(text) || /49\s*Kč/.test(text);

    expect(rule('Získáte 3 měsíce zdarma, pak 49 Kč měsíčně.')).toBe(true);
    expect(rule('Objednat za 49 Kč měsíčně')).toBe(true);
    expect(rule('Zcela zdarma, bez závazků.')).toBe(false);
  });

  it.each(VARIANTS.map((v) => [v.id, v] as const))(
    '%s sells on the price, never on the word "zdarma"',
    (_id, variant) => {
      // The question being tested is whether anyone will pay 49 Kč. Leading with "free" would
      // measure appetite for a free thing instead — a different question with a useless answer.
      const selling = [variant.h1, variant.lede, variant.cta, variant.ctaNote, ...variant.bullets].join(' ');
      expect(selling).not.toMatch(/zdarma|nic nestojí/i);
      expect(variant.cta).toMatch(/49\s*Kč/);
    },
  );

  it('reveals the launch offer only after the priced button, and states the price in it', () => {
    const html = renderLanding(VARIANTS[0]);
    // Present in the markup but hidden until the click — the measurement is the click, and the
    // offer must not be what draws it.
    expect(html).toMatch(/<section class="offer" id="offer" hidden>/);
    expect(html).toMatch(/3 měsíce zdarma/);
    expect(html).toMatch(/49\s*Kč/);
  });

  it('asks for no payment details anywhere', () => {
    // The bright line: this measures willingness to pay, it does not take payment. A field that
    // collected card details under a button that charges nothing would be a different thing
    // entirely from an interest test.
    for (const [, html] of rendered) {
      // No form fields at all — nothing on this page collects anything from anyone.
      expect(html).not.toMatch(/<input|<form/i);

      // And nothing in the visible text asks for payment credentials. Checked against the text
      // rather than the markup, because a CSS variable named `--card` is not a card field.
      const text = html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
      expect(text).not.toMatch(/číslo karty|platební kart|cvv|iban|kreditní/i);
    }
  });

  it.each(rendered)('%s keeps the compliance notice', (_id, html) => {
    expect(html).toMatch(/neobchází/i);
    expect(html).toMatch(/ověřen/i);
  });

  it.each(rendered)('%s keeps the full legal footer', (_id, html) => {
    expect(html).toContain('Alfares s.r.o.');
    expect(html).toMatch(/nejsou spojeny s Bazoš\.cz/);
    for (const link of ['/privacy', '/cookies', '/terms', '/ai']) {
      expect(html).toContain(link);
    }
  });

  it.each(rendered)('%s stays out of search results', (_id, html) => {
    // An experiment variant competing with the real site in organic search would pollute both.
    expect(html).toContain('noindex');
  });

  it.each(rendered)('%s records its own id, not another', (_id, html) => {
    expect(html).toContain(`var LANDING_VERSION = ${JSON.stringify(_id)}`);
  });
});

describe('findVariant', () => {
  it('returns the variant asked for', () => {
    expect(findVariant('v1-cena')?.id).toBe('v1-cena');
  });

  it('returns nothing for an unknown id instead of a default', () => {
    // A fallback would serve one variant's copy while recording another's id, and the experiment
    // would compare pages nobody read.
    expect(findVariant('v9-does-not-exist')).toBeUndefined();
    expect(findVariant('')).toBeUndefined();
  });
});

describe('rendering', () => {
  it('escapes the copy rather than trusting it', () => {
    const hostile = { ...VARIANTS[0], h1: '<script>alert(1)</script>' };
    expect(renderLanding(hostile)).not.toContain('<script>alert(1)</script>');
    expect(renderLanding(hostile)).toContain('&lt;script&gt;');
  });

  it('shows the price and the call to action', () => {
    const html = renderLanding(VARIANTS[0]);
    expect(html).toContain(VARIANTS[0].cta);
    expect(html).toMatch(/49\s*Kč/);
  });
});
