# Official submission requirements: re-check of 2026-10-31

Internal preparation note. Decide whether to keep or remove it before the repository is made public.

Checked on 2026-10-31 at about 23:30 EDT (2026-11-01 03:30 UTC), signed out. The public event page and the Official Rules page were fetched and rendered in a headless browser with an empty profile. The participant guide (event "Details" page) and the submission form require sign-in, so this check could not re-verify them. Rules and dates can change; the event page says changes will be posted there.

## Deadline

| Item | Value | Source |
|---|---|---|
| Submission deadline | **Wednesday 2026-11-04, 9:00 PM Eastern** | Event page, Key Dates |
| Same instant in UTC | **2026-11-05 02:00 UTC** | Event record embedded in the event page (`hackathonSubmissionDueDate`) |
| Eastern offset on Nov 4 | EST, UTC−5. US daylight saving time ends Sunday 2026-11-01. | Calendar |
| Pacific equivalent | Wednesday 2026-11-04, 6:00 PM PST | Calculated |
| Time left at this check | About 94 hours | Calculated from 2026-11-01 03:45 UTC |

The embedded event record also contains a six-hour grace-period setting. It is not a published allowance, and the brief records that late submissions are not considered. Plan to submit well before 9:00 PM EST.

## Requirements and where each one comes from

"Re-verified" means the requirement appeared on a public page during this check. "Brief only" means it is recorded in `docs/hackathon-brief.md` from the participant guide on 2026-10-29 and still needs a signed-in check.

| Requirement | Source | Status on 2026-10-31 |
|---|---|---|
| Submit through the Cerebral Valley portal at `cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit` | Official Rules | Re-verified. The form fields are not visible signed out. |
| Deadline Nov 4, 9:00 PM ET | Event page | Re-verified |
| A project enters one track only | Official Rules | Re-verified |
| Indie track: individual builders and students, teams of up to four | Official Rules | Re-verified |
| A team appoints one Representative, who submits and names every other team member in the submission | Official Rules | Re-verified |
| Judging: Impact 30%, Use of Meta AI Tooling 25%, Technical Depth & Execution 20%, Demo 25% | Official Rules | Re-verified. The Demo criterion covers a working demo, whether the product holds up live, and the quality of the demo video. |
| The submission must be the entrant's original work, owned by the entrant with no other party holding rights in it, and must not infringe anyone's IP or contract rights. Open-source components are allowed if their licenses are followed. | Official Rules | Re-verified. This drives the rights review of `codesys/codesys_handoff/` in the claims checklist. |
| The entrant keeps ownership and grants the organizers a perpetual, irrevocable, worldwide, royalty-free, non-exclusive license. Shared materials are not confidential. | Official Rules | Re-verified |
| $150 Meta Model API credits per selected participant, valid for a 10-day development window | Official Rules | Re-verified. **Not in the brief.** Check the expiry on the Meta billing page before scheduling the paid Wonder-directed run. |
| Repository must be public and accessible | Participant guide | Brief only |
| Three-minute demo video showing the features built during the hackathon; link must open without requesting permission | Participant guide | Brief only |
| The demo may highlight only work built during the hackathon; new work must be clearly identified, or the entry can be disqualified | Participant guide | Brief only |
| List everyone who worked on the project | Participant guide; also implied by the Representative rule | Brief only, partly re-verified |
| Late submissions are not considered | Participant guide | Brief only |
| Last full day for submission questions and troubleshooting is Tue Nov 3 | Participant guide | Brief only |

## Dates that differ from the brief

| Item | Brief (2026-10-29) | Public pages (2026-10-31) |
|---|---|---|
| Judging period | Thu Nov 5 – Sun Nov 8 | Nov 4 – Nov 8 (event page) |
| Community-vote announcement | Mon Nov 16, in Discord | The Official Rules say additional prizes, including any public-vote prize, will be announced on or about Nov 10 |
| Closing ceremony | Mon Nov 9, 12:00 PM ET | Nov 9; no time on the public page |
| Credit validity | Not recorded | 10-day development window |
| Event start | Mon Oct 26, 12:00 PM ET | 2026-10-26 17:00 UTC, which is 1:00 PM EDT (12:00 PM EST). Not material to the submission. |

The event record shows a last update at 2026-10-30 19:57 UTC, after the brief was written. The bonus-category amounts in the brief come from the participant guide; the public rules only cap bonus prizes at $50,000 in total.

## Checks that need the builder, signed in

These cannot be done from a signed-out session. Doing them before Tue Nov 3 leaves time to ask questions in Discord.

1. Open the submission form. Copy every field name, character limit and required/optional flag into `submission-text.md`, then fit the drafts to them.
2. Confirm the video rules: length limit, accepted hosts (for example YouTube or Loom), and whether unlisted links are accepted.
3. Confirm whether the form asks for a live-product URL, and what judges expect when the product needs a local PLC runtime.
4. Re-read the participant guide for changes since 2026-10-29, especially the new-work rule and the repository rule.
5. Read Discord `#announcements` for date or rule changes.
6. Check the Meta Model API billing page for the remaining credit and its expiry.

## Sources

- [Event page, Meta Global AI Developer Hackathon, Cerebral Valley](https://cerebralvalley.ai/e/meta-ai-developer-hackathon): dates, tracks, themes.
- [Official Rules and Event Waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver): portal, tracks, judging criteria, prizes, credits, ownership and license terms.
- [Submission portal](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit): requires sign-in.
- [Participant guide / Details](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details): requires sign-in.
- [Meta event page](https://dev.meta.ai/events/global-hackathon): application review criteria.

The requirement text above is paraphrased from these pages. Content was rephrased for compliance with licensing restrictions.
