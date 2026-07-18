# MS-P — Communication channels (parallel track)

**Status:** ready now — **does not block any other milestone** · **Integration owner:** Claude
**Contains:** F-002 (S2 WhatsApp inbound), F-003 (S3 system-wide email), F-004 (S4 reply→lead linkage)

## Why parallel, not a gate

The qualified-lead definition requires a reply on WhatsApp, Telegram or email. **Manual qualification does not require automated linkage** — the owner sees the reply on his own phone and marks the lead. So these slices do not block the first experiment.

They remain a real, independent owner requirement: a third communication channel is needed regardless of the growth project. Currently only Telegram and email work.

They gate: automatic reply evidence · reply-qualified conversion upload · multi-user lead handling · reduced qualification latency against the offline-conversion upload deadline.

## Verified channel state

| Channel | Outbound | Inbound | → `leadId` |
|---|---|---|---|
| Telegram | ✅ | ✅ webhook | ❌ |
| Email | ✅ | ✅ **exists** — `inbound-email.controller.ts`, `webhook-subscription.service.ts`, `s3-unprocessed-catchup.scheduler.ts`, scoped to `@speakasap.com` | ❌ |
| WhatsApp | ✅ send only | ❌ **absent** | ❌ |

**S3 is re-scoping existing generic webhook-subscription infrastructure, not building from zero.** WhatsApp inbound is the only entirely missing channel.

## Exit criteria

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | WhatsApp inbound webhook received and verified | Integration test | ☐ |
| 2 | Inbound email subscription works for a non-speakasap domain | Integration test | ☐ |
| 3 | Inbound message on any channel links to `leadId` | Integration test | ☐ |
| 4 | `engagementStatus` transitions on reply, separate from `qualificationStatus` | Contract test | ☐ |
| 5 | Owner sends and receives on all three channels from the system | Owner manual check | ☐ |

## Scope boundary

Required owners: `notifications`, `leads`. **Marketing and growth-core are excluded** — they gain the capability when they have a defined consumer requirement (owned-channel journey; qualification projection), not pre-emptively.
