# VR-002 — Google Ads campaign structure for Bazos landing test

**Type:** validation_report · **Status:** ✅ created, everything PAUSED
**Milestone:** MS-002 · **Date:** 2026-07-22
**Depends on:** [VR-001](VR-001-google-ads-api-access.md)

---

## Summary

A four-variant Search campaign for **Alfares Bazoš** (49 Kč/month, CZ only) was created in ad
account `277-138-1970` via the Google Ads API v21. **Nothing is enabled and nothing can spend.**
Every campaign, ad group, keyword and ad was created with `status: PAUSED`, on a **1 CZK/day**
budget. The owner enables it after setting spend limits.

The four ad groups map one-to-one onto the four live landing variants — that mapping *is* the
A/B test, so each ad has exactly one `final_url`.

---

## Target account — verified before creating anything

`customers:listAccessibleCustomers` returned HTTP 200 with three customers; the intended target
was confirmed by a `customer` query before any write:

| Field | Value |
|---|---|
| Customer ID | `2771381970` = **277-138-1970** ✅ matches the assigned account |
| Descriptive name | Alfares s.r.o. |
| Currency | **CZK** |
| Time zone | Europe/Prague |
| Manager / test account | `false` / `false` |
| Status | ENABLED |
| **Auto-tagging** | **already enabled** — see Tracking |

Pre-existing content in the account, **left untouched**: one campaign `85667675`
"Немецкий в скайпе" (status `REMOVED`) and its budget `94317275` (`REMOVED`). No existing object
was read-modified-written, paused, or deleted.

---

## What was created

One atomic `googleAds:mutate` of 32 operations — all-or-nothing, so a partial structure could not
be left behind. Run `validateOnly: true` first; it passed, then committed.

### Budget

| Name | ID | Amount | Delivery | Shared |
|---|---|---|---|---|
| `Bazos \| Search \| CZ \| 1 CZK/day` | `15731511509` | **1 000 000 micros = 1,00 CZK/day** | STANDARD | no |

### Campaign — PAUSED

| Field | Value |
|---|---|
| Name | `Bazos \| Search \| CZ \| LP test` |
| ID | **`24057228449`** |
| **Status** | **`PAUSED`** |
| Channel | SEARCH |
| Bidding | `MANUAL_CPC`, enhanced CPC **off** |
| Networks | Google Search **only** — search partners, display and partner search all `false` |
| Geo | `geoTargetConstants/2203` — Czechia, `positiveGeoTargetType: PRESENCE` (people *in* CZ, not merely interested) |
| Language | `languageConstants/1021` — Czech |
| EU political advertising | `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` (required field in v21) |

Three `DEVICE` campaign criteria appear in the read-back. Those are added automatically by Google
(all devices, default bid modifiers) — they were not part of the request.

### Ad groups, keywords, ads — all PAUSED

| Ad group | ID | Landing (`final_url`) | Max CPC | Keywords | RSA ad ID |
|---|---|---|---|---|---|
| `Bazos \| v1 cena` | `200082993833` | `/l/v1-cena` | 3,00 CZK | 5 | `817968298928` |
| `Bazos \| v2 obnova` | `200082994273` | `/l/v2-obnova` | 3,00 CZK | 5 | `817968315263` |
| `Bazos \| v3 cas` | `197295480454` | `/l/v3-cas` | 3,00 CZK | 5 | `817968315290` |
| `Bazos \| v4 pravidla` | `200082996433` | `/l/v4-pravidla` | 3,00 CZK | 5 | `817968315317` |

Each RSA carries 9 headlines (≤30 chars) and 4 descriptions (≤90 chars), all Czech with diacritics.
20 keywords total, all `PHRASE` match, all `PAUSED`.

Keywords by group:

- **v1 cena** — automatizace inzerátů bazoš · nástroj na inzeráty bazoš · levná správa inzerátů · správa inzerátů cena · program na inzeráty bazoš
- **v2 obnova** — obnova inzerátů bazoš · obnovování inzerátů · vypršel inzerát bazoš · automatická obnova inzerátů · platnost inzerátu bazoš
- **v3 cas** — hromadné vkládání inzerátů · správa inzerátů bazoš · automatické vkládání inzerátů · nástroj pro prodejce bazoš · jak rychle inzerovat na bazoši
- **v4 pravidla** — pravidla bazoš inzeráty · limit inzerátů bazoš · kolik inzerátů na bazoši · pravidla inzerce bazoš · podmínky inzerce bazoš

---

## ✅ Proof that nothing is live

Read back from the API *after* creation — not inferred from the write response:

```
campaign     total=  1 PAUSED=  1 ENABLED=0
adGroup      total=  4 PAUSED=  4 ENABLED=0
adGroupAd    total=  4 PAUSED=  4 ENABLED=0
keyword      total= 20 PAUSED= 20 ENABLED=0

objects created: 29
ASSERTION: PASS - zero ENABLED objects
```

Account-wide campaign list, confirming nothing else was disturbed:

```
85667675     REMOVED | Немецкий в скайпе      <- pre-existing, untouched
24057228449  PAUSED  | Bazos | Search | CZ | LP test
```

Ad policy review status is `REVIEW_IN_PROGRESS` / approval `UNKNOWN` for all four ads. Google
reviews ads even while paused; the owner should re-check approval before enabling, because a
disapproved ad reveals itself only at review completion.

**The validation harness was falsified before being trusted.** A probe submitting a budget of
`-5` micros under `validateOnly: true` returned HTTP 400
`MONEY_AMOUNT_LESS_THAN_CURRENCY_MINIMUM_CPC`, proving the pass on the real payload was a real
pass and not a silently-accepted no-op.

---

## Tracking

**Auto-tagging was already enabled** on the account (`customer.auto_tagging_enabled: true`), so
`gclid` will be appended without any change from here. **No account-level setting was modified** —
per the brief, that would have been reported rather than done, and it turned out to be unnecessary.

UTM parameters were added at **campaign level** (`final_url_suffix`, a property of the new campaign
only, not an account setting):

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}&utm_id={creative}
```

The landings read `gclid` and `utm_*` from the query string and record them as attribution
touchpoints, so both mechanisms feed the same pipeline. `utm_content={adgroupid}` is what
distinguishes the four variants in attribution — it is the field the A/B analysis keys on.

---

## Compliance constraints applied to the copy

From `GOAL-06` and `BUSINESS.md` in the `bazos` repo — these are compliance constraints, not style:

- **No bypass claims.** No headline or description implies Bazoš's rules, limits, phone
  verification or CAPTCHAs are circumvented. A scripted check asserted that every occurrence of
  the stem `obcház` is the negated form `neobcházíme` ("we do not bypass"). v4 states the position
  explicitly: *"Nic neobcházíme"*, *"Pracujeme v pravidlech Bazoše, ne mimo ně."*
- **No free claims.** Every ad group names the 49 Kč/month price. The 3-months-at-no-cost launch
  offer is on the landing pages but deliberately **not** in the ads, so no ad can read as "free".
- Copy was written against the actual live landing text (all four fetched and read), so ad and
  landing make the same argument.

⚠️ **A native Czech speaker must review the copy before the budget is raised.** I am not one. The
diacritics and grammar are believed correct and the lengths are validated, but idiom and tone in
ad copy are exactly what a non-native writer gets subtly wrong, and this text is the variable the
whole A/B test measures.

⚠️ **Trademark risk, unresolved.** Ad text and keywords contain "Bazoš" / "bazoš". Bidding on the
term is permitted under Google's trademark policy, but *use in ad text* can be disapproved on a
trademark complaint from the owner of Bazoš.cz. The landings already carry the disclaimer
*"Tato stránka ani služba nejsou spojeny s Bazoš.cz"*. If the four ads come back disapproved for
trademark, the fix is to strip "Bazoš" from headlines/descriptions and keep it in keywords only.
This is a decision for the owner, not a defect to fix silently.

---

## What the owner must do to go live

In order. Steps 1–2 are the safety gate; do not skip them.

1. **Set an account-level spend limit** in `277-138-1970`. Explorer access blocks billing
   endpoints, so this cannot be done via API — it must be done in the UI. This is Phase-0 tracker
   item **13**, still open.
2. **Confirm billing is configured** on the account. It has never spent; a payment method may not
   be attached.
3. **Raise the daily budget.** 1 CZK/day is a fuse, not a budget — at that level Google will
   almost certainly serve **zero impressions**, so leaving it there produces no test data at all.
   Budget `15731511509`, set to something that can actually buy clicks in the CZ Search auction.
4. **Have a native speaker review the Czech copy** (see above).
5. **Check ad approval status** — all four are still in review.
6. **Enable, innermost first**: keywords → ads → ad groups → campaign. Enabling the campaign while
   its children are paused serves nothing, and it is the campaign flip that starts the spend.
7. Decide the trademark question if any ad is disapproved.

---

## Blocked by Explorer access tier

| Wanted | Blocked because | Consequence |
|---|---|---|
| Keyword volume / competition data | Explorer blocks **planning tools** (Keyword Planner API) | The 20 keywords are reasoned from the landing copy and the product, **not** validated against real search volume. Some may have near-zero traffic. Re-derive them once Basic lands. |
| Setting the account spend limit via API | Explorer blocks **billing** | Owner must do it in the UI (step 1) |
| Creating accounts / managing users | Explorer blocks both | Not needed here |

Basic access was applied for 2026-07-19 (~5 business days). Nothing in this report is blocked on
it — campaign creation works fine at Explorer, as VR-001 predicted. Only keyword *research*
quality is affected.

Operations consumed by this work: 32 mutate operations plus a handful of reads, against the
Explorer ceiling of 2 880/day. Not a constraint at this volume.

---

## Reproduce / inspect

```bash
export VAULT_ADDR=http://127.0.0.1:8200
python3 growth/scripts/verify-api-access.py     # confirms credentials still work
```

Read the structure back:

```
SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
FROM campaign WHERE campaign.id = 24057228449
```

Credentials are read from Vault `secret/prod/growth` at run time. No secret appears in this
document or in any script output.
