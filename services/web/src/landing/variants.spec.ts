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

  it('would catch a variant that said "zdarma" with no price anywhere', () => {
    // The rule above passes on the real variants partly because the price appears in several
    // places. This proves the rule can actually fail, rather than being satisfied by accident.
    const misleading = {
      ...VARIANTS[0],
      lede: 'Zcela zdarma.',
      bullets: ['Zdarma'],
      cta: 'Zdarma',
      ctaNote: 'Zdarma',
      h1: 'Zdarma',
      title: 'Zdarma',
    };
    const html = renderLanding(misleading);
    const saysFree = /zdarma|nic nestojí/i.test(html);
    const statesPrice = /49\s*Kč/.test(html);
    expect(saysFree).toBe(true);
    expect(statesPrice).toBe(false); // …which is exactly what the rule forbids
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
