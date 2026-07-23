import type { ExperimentReport } from './experiment-report.service';

/**
 * C-006 §6.7 — the owner's screen.
 *
 * Server-rendered, no client framework, no build step. It is a page of numbers and one form; a
 * bundler between the owner and his spend figure would be cost with no return.
 *
 * Served from `growth-core`, which has NO ingress. That is deliberate: this screen shows spend and
 * lead counts, and `growth-web` — the only container in this platform with a public route — has no
 * authentication whatsoever. Publishing this on a public host needs an authenticated surface
 * first, which is an owner decision and is not taken here (C-006 §6.8).
 */

/** Every interpolated value goes through this. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A null metric is an em dash. Never 0, never NaN — see C-006 §6.3. */
function metric(value: string | null, currency: string | null): string {
  return value === null ? '—' : `${esc(value)}${currency ? ` ${esc(currency)}` : ''}`;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

export function renderExperimentScreen(report: ExperimentReport): string {
  const { attribution: attr, verdicts: v, spend, outOfScope } = report;

  // One line per campaign plus, when it exists, the spend the owner did not split. Unassigned is
  // labelled rather than blank: an empty cell reads as a rendering fault, not as a fact (C-006 §2.5).
  const campaignRows = spend.byCampaign
    .map(
      (row) => `<tr><th>${row.campaignId === null
        ? '<em>unassigned</em>'
        : esc(row.campaignId)}</th>
      <td class="n">${esc(row.total)}${report.currency ? ` ${esc(report.currency)}` : ''}</td>
      <td class="n note">${esc(row.observations)} entr${row.observations === 1 ? 'y' : 'ies'}</td></tr>`,
    )
    .join('\n  ');

  const campaignTable = spend.byCampaign.length
    ? `<table>
  <tr><th colspan="3" class="note">spend by campaign — the total above is the sum of these</th></tr>
  ${campaignRows}
</table>
${spend.byCampaign.some((row) => row.campaignId === null) && spend.byCampaign.length > 1
        ? `<p class="note">Unassigned spend is money you entered without naming a campaign. It stays
           in the total and in every cost metric — it left the account either way.</p>`
        : ''}`
    : '';

  const scopeNote =
    outOfScope.otherExperiments + outOfScope.noTouchpoint > 0
      ? `<table>
  <tr><th>leads on another experiment</th><td class="n">${esc(outOfScope.otherExperiments)}</td></tr>
  <tr><th>leads with no touchpoint</th><td class="n">${esc(outOfScope.noTouchpoint)}</td></tr>
</table>
<p class="note">Neither group is counted above. Leads with <strong>no touchpoint</strong> are real
   registrations whose landing view was never recorded — a direct signup, a cleared cookie, refused
   consent, or anyone who arrived before this measurement existed. They are excluded from this
   experiment's denominator, which makes its cost per registration read <em>worse</em> than reality.
   If this number dwarfs the one above, the measurement chain is broken, not the experiment.</p>`
      : '';

  const currencyNote = spend.mixedCurrency
    ? `<p class="warn">This experiment has spend in <strong>more than one currency</strong>, so no
       total and no cost metric is shown. Summing them would produce a number that is wrong and
       looks correct.</p>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Experiment ${esc(report.experimentId)} — growth</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 2rem;
         max-width: 46rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  .scope { color: #666; font-size: .85rem; margin: 0 0 2rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid #8883; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.metric td { font-weight: 600; }
  .note { color: #666; font-size: .85rem; }
  .warn { background: #fde68a44; border-left: 3px solid #d97706; padding: .6rem .8rem;
          font-size: .9rem; }
  fieldset { border: 1px solid #8884; border-radius: 6px; padding: 1rem 1.2rem; }
  legend { font-weight: 600; padding: 0 .4rem; }
  label { display: block; margin: .6rem 0 .15rem; font-size: .85rem; }
  input { width: 100%; padding: .4rem .5rem; font: inherit; box-sizing: border-box; }
  .row { display: flex; gap: 1rem; }
  .row > div { flex: 1; }
  button { margin-top: 1rem; padding: .5rem 1.1rem; font: inherit; cursor: pointer; }
</style></head><body>

<h1>Experiment · ${esc(report.experimentId)}</h1>
<p class="scope">Workspace <strong>${esc(report.workspaceId)}</strong> ·
   generated ${esc(report.generatedAt)}</p>

${currencyNote}

<table>
  <tr><th>spend (manual)</th>
      <td class="n">${metric(spend.total, report.currency)}</td></tr>
  <tr><th>registrations</th><td class="n">${esc(report.registrations)}</td>
      <td class="note">leads that came from this experiment</td></tr>
  <tr class="metric"><th>cost per registration</th>
      <td class="n">${metric(report.costPerRegistration, report.currency)}</td></tr>
</table>

${campaignTable}

${scopeNote}

<table>
  <tr><th>attributed</th>
      <td class="n">${esc(attr.attributed)}</td>
      <td class="n note">${pct(attr.attributed, report.registrations)}</td></tr>
  <tr><th>unattributed</th>
      <td class="n">${esc(attr.unattributed)}</td>
      <td class="n note">${pct(attr.unattributed, report.registrations)}</td></tr>
</table>
<p class="note">Unattributed registrations are real conversions we cannot link to a click:
   the visitor refused <strong>consent</strong>, or cleared the cookie. Measured conversions are
   therefore structurally <em>lower</em> than actual, and cost per registration reads
   <em>worse</em> than reality. Read the two together.</p>

<table>
  <tr><th>qualified</th><td class="n">${esc(v.qualified)}</td></tr>
  <tr><th>disqualified</th><td class="n">${esc(v.disqualified)}</td></tr>
  <tr><th>pending</th><td class="n">${esc(v.pending)}</td>
      <td class="note">counted against cost, not as qualified</td></tr>
  <tr class="metric"><th>cost per qualified lead</th>
      <td class="n">${metric(report.costPerQualifiedLead, report.currency)}</td></tr>
</table>
<p class="note">Cost per qualified lead is the <strong>full</strong> spend divided by the qualified
   count. Pending and disqualified leads stay in the numerator — you paid for those clicks either
   way. A backlog of pending makes this read worse than the experiment deserves, which is why the
   pending count sits next to it.</p>

<form method="post" action="/experiments/${esc(report.experimentId)}/spend">
  <fieldset>
    <legend>Enter spend</legend>
    <div class="row">
      <div><label for="periodStart">period start</label>
           <input id="periodStart" name="periodStart" type="date" required></div>
      <div><label for="periodEnd">period end</label>
           <input id="periodEnd" name="periodEnd" type="date" required></div>
    </div>
    <div class="row">
      <div><label for="amountValue">amount (decimal, e.g. 1500.00)</label>
           <input id="amountValue" name="amountValue" inputmode="decimal"
                  pattern="-?\\d+(\\.\\d{1,4})?" placeholder="1500.00" required></div>
      <div><label for="amountCurrency">currency</label>
           <input id="amountCurrency" name="amountCurrency" value="${esc(report.currency ?? 'CZK')}"
                  pattern="[A-Z]{3}" required></div>
    </div>
    <label for="campaignId">campaign (optional — leave empty if the figure is not split)</label>
    <input id="campaignId" name="campaignId"
           placeholder="e.g. Bazos · CZ · search">
    <label for="evidenceReference">evidence reference (which report this came off)</label>
    <input id="evidenceReference" name="evidenceReference" required
           placeholder="Google Ads · campaign report 2026-07-22">
    <label for="enteredBy">entered by</label>
    <input id="enteredBy" name="enteredBy" value="owner" required>
    <button type="submit">Record spend</button>
    <p class="note">Recorded, never edited. A correction is a new entry; both stay readable.</p>
  </fieldset>
</form>

</body></html>`;
}
