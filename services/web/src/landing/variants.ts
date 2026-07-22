/**
 * Landing variants for the first experiment (F-005 §1).
 *
 * A variant is an **immutable clone**: it is never edited in place. Changing a word means a new
 * `landingVersionId`, because every touchpoint already recorded carries the old one, and editing
 * copy under a stable id would silently attribute yesterday's results to today's page.
 *
 * ## What may be claimed here
 *
 * Every claim below is traceable to something the business already states publicly on
 * `bazos.alfares.cz` or to `GOAL-06`, which requires the landing to state the 49 Kč/month price
 * and the compliance constraints "without implying bypasses". Two rules follow, and they are not
 * stylistic:
 *
 * 1. **Nothing may imply that Bazoš limits, verification or CAPTCHAs are worked around.** The
 *    service works *within* them; that is the product. A variant that hints otherwise is not
 *    aggressive marketing, it is a description of a service Alfares does not and must not offer.
 * 2. **No claim of a free service.** Registration costs nothing and is described as such; the
 *    service is 49 Kč/month and the price appears beside it every time. "Zdarma" alone, next to a
 *    paid subscription, is the kind of copy a consumer-protection authority reads differently
 *    from a marketer.
 *
 * ⚠️ The Czech here was not written by a native speaker. It is idiomatic and grammatical to the
 * best of my ability, but it is going in front of paid traffic — have a native read it before the
 * budget starts.
 */

export interface LandingVariant {
  id: string;
  /** One line for the experiment log: what this variant is actually testing. */
  angle: string;
  title: string;
  h1: string;
  lede: string;
  bullets: string[];
  cta: string;
  /** Reassurance directly under the button, where the hesitation happens. */
  ctaNote: string;
}

const PRICE = '49 Kč měsíčně';

export const VARIANTS: LandingVariant[] = [
  {
    id: 'v1-cena',
    angle: 'Price anchor — the whole offer led by how little it costs.',
    title: 'Prodávejte na Bazoši za 49 Kč měsíčně | Alfares',
    h1: 'Prodávejte na Bazoši za 49 Kč měsíčně',
    lede:
      'Alfares za vás připraví inzeráty, obnovuje je před vypršením a hlídá limity Bazoše. ' +
      'Vy vybíráte zboží a expedujete.',
    bullets: [
      'Automatická příprava i obnova inzerátů',
      'Bez ručního přepisování názvů, cen a fotek',
      `Vše za ${PRICE} — méně než jedna káva`,
    ],
    cta: 'Registrace zdarma',
    ctaNote: `Registrace nic nestojí. Služba pak ${PRICE}.`,
  },
  {
    id: 'v2-obnova',
    angle:
      'Expiry and renewal — the loss is invisible, which is why it goes unfixed. ' +
      'Aimed at sellers whose ads quietly stop being seen.',
    title: 'Vaše inzeráty na Bazoši nevyprší nepovšimnutě | Alfares',
    h1: 'Inzerát, který vypršel, už nikdo nevidí',
    lede:
      'Alfares hlídá platnost vašich inzerátů a obnovuje je v intervalech, které Bazoš povoluje. ' +
      `Vy se o termíny nestaráte. ${PRICE}.`,
    bullets: [
      'Obnova inzerátů v povolených intervalech — nic neobcházíme',
      'Přehled o tom, co je aktivní a čemu končí platnost',
      'Nové inzeráty se připraví samy, vy je jen odsouhlasíte',
    ],
    cta: 'Registrace zdarma',
    ctaNote: `Registrace nic nestojí. Služba pak ${PRICE}.`,
  },
  {
    id: 'v3-cas',
    angle: 'Time is the cost — aimed at sellers who already post manually and hate it.',
    title: 'Přestaňte přepisovat inzeráty ručně | Alfares Bazoš',
    h1: 'Přestaňte přepisovat inzeráty ručně',
    lede:
      'Každý inzerát znovu vyplnit, pohlídat, obnovit. Alfares to připraví a sleduje za vás — ' +
      `${PRICE}.`,
    bullets: [
      'Připravený inzerát zkontrolujete a odešlete',
      'Přehled stavu všech inzerátů na jednom místě',
      'Upozornění dřív, než inzerát vyprší',
    ],
    cta: 'Vyzkoušet',
    ctaNote: `Registrace nic nestojí. Služba ${PRICE}.`,
  },
  {
    id: 'v4-pravidla',
    angle: 'Fear of a ban — for sellers who have been blocked or are near the limits.',
    title: 'Inzerujte na Bazoši v souladu s pravidly | Alfares',
    h1: 'Inzerujte na Bazoši bez porušení pravidel',
    lede:
      'Ověřená identita, limit aktivních inzerátů, intervaly kategorií a kontrola duplicit — ' +
      'hlídáme je za vás. Nic neobcházíme.',
    bullets: [
      'Kontrola pravidel dřív, než inzerát odejde',
      'Přehled o tom, co je aktivní a co čeká na kontrolu',
      `Ověřená identita zůstává vaše. ${PRICE}.`,
    ],
    cta: 'Registrace zdarma',
    ctaNote: `Registrace nic nestojí. Služba pak ${PRICE}.`,
  },
];

const BY_ID = new Map(VARIANTS.map((variant) => [variant.id, variant]));

/**
 * Returns the variant, or nothing.
 *
 * There is deliberately **no fallback to a default**. Serving some other page under an unknown id
 * would record touchpoints against a variant the visitor never saw, and the experiment would then
 * compare copy nobody read — a result that looks like data and is not.
 */
export function findVariant(id: string): LandingVariant | undefined {
  return BY_ID.get(id);
}
