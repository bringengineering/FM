# Photo classification v2 verification

This change separates room/object/category/action evidence, holds contradictions,
rejects time-only before/after pairs, and performs at most one six-image refinement
request per 30-image classification request. The same stripped overview plus one
central detail are used in refinement; the crop is not claimed to cover every object.
Manual corrections stay authoritative. Report status is separate from photo phase.

## What automated tests establish

Synthetic provider responses verify contracts, evidence gates, crop/request bounds,
privacy, save/PDF preservation, manual correction and date/activity deduplication.
They **do not establish real photograph recognition accuracy**.

## Real-photo acceptance test (independent held-out validation pending)

Use the same 10–30 or more independently labeled photographs for both versions.
Include clear/ambiguous hood vs air-conditioner filters, detached refrigerator
parts, common-area work-in-progress, tool-only/person-standing scenes, low-quality
closeups, different rooms with similar tiles, and repeated monthly visits.

Keep original images and private IDs outside Git. Create anonymous IDs and manually
check category, space, target, phase and scene identity before running the candidate.
Use the approved CRM/Worker path or the opt-in local harness below for analysis;
do not put API keys in the evaluation file or CLI. Do not send additional photos
without authorization.

### Local real-photo comparison (not a deployment)

`crm-ai-worker/scripts/evaluate-local-photos.mjs` runs the fixed pre-change Worker
baseline and current Worker functions, followed by the real desktop response
normalization and bounded refinement selector/merge. The client normalization is
exercised with a local in-memory response, not an authentication bypass or server.
The earliest runs below predate this transport check. It opens no server and does not change any
authentication, production endpoint, Firebase data, rules, or Drive originals.
The user enters their existing key directly in ignored `crm-ai-worker/.dev.vars`.
The harness never prints the key, raw provider response, image bytes, private
Drive identifiers, original filenames, or reference notes. Only the fixed Gemini
HTTPS model endpoint is permitted, redirects are disabled, and there are call,
payload, response and time limits. A live run can incur ordinary API usage costs.

Use a reviewed private directory outside Git with `selection-and-reference.json`,
`prepared-manifest.json`, and stripped, bounded `prepared/<id>-whole.jpg` and
`prepared/<id>-detail.jpg` images. Only authorized selected images are included.
Reference labels must be finalized before the model run. Unknown/unlabeled axes
must not be replaced with the model's own predictions.

From `crm-ai-worker`, first run `node scripts/evaluate-local-photos.mjs --check
--dataset <private-directory>` (no API calls). Only after the user confirms key
setup and authorizes this dataset, run with `--live` instead. No automatic retries.
Each run creates a new private `model-comparison-<random-id>.json`, with immutable
reference/image/source hashes and normalized results; no original is overwritten.
The current harness measures classification/refinement only, **not** before/after
pair recall, the authenticated installed app, monthly selection, or PDF output.
Those gates require separate tests. Prepared Pillow images share the same bounds
but are not byte-identical to Electron encodings. The initial two-site set has
assistant-reviewed labels and is not an independent held-out accuracy benchmark.

### First real comparison, 2026-10-12 (not acceptance)

The authorized two-site sample contains 30 images: 12 common-area and 18 move-in.
The unchanged baseline used five successful Gemini requests. The first working
candidate used seven (including bounded refinement), with no failed requests.
Measured classifier/refinement time was about 9.4 s vs 17.6 s, excluding download,
preprocessing, app authentication and report/PDF generation. Different calls are
stochastic; these single-run times and scores are not production guarantees.

| Axis | Labeled | Baseline correct / accepted | Candidate correct / accepted | Baseline / candidate coverage |
| --- | ---: | ---: | ---: | ---: |
| Category | 22 | 20 / 21 | 16 / 16 | 95.5% / 72.7% |
| Space | 7 | 6 / 7 | 3 / 3 | 100% / 42.9% |
| Target | 25 | 21 / 24 | 20 / 23 | 96% / 92% |
| Visible work phase | 28 | 2 / 3 | 2 / 3 | 10.7% / 10.7% |

These results **do not meet the accuracy objective**: category precision increased
through more abstention, but target errors and one unsupported work-in-progress
assignment remain. Some known-room images were needlessly held by the generic
room-evidence gate. Before/after pairs were not exercised by this harness; empty
pair metrics must not be interpreted as verified zero false pairs or good recall.
Reference labels and original predictions are retained privately and hashed;
do not modify them to agree with a later candidate or treat this tuning set as a
fresh held-out benchmark.

Real integration found two issues not exposed by synthetic tests: authorization
keys containing dots were rejected by the initial local parser (now treated as
opaque header-safe credentials), and the candidate's nested bounded enum arrays
received HTTP 400. Removing nested array maxItems from the provider grammar
resolved the observed rejection; closed vocabulary, response-byte caps and local
8-feature/2-candidate bounds remain enforced. Earlier rejected probes are saved
as separate failed runs and excluded from recognition accuracy, not hidden.

### Subsequent tuning on the same set (not held-out accuracy)

Room evidence now recognizes a kitchen counter/cooking fixture and paired
sink/cabinet layout without requiring the generic room token. A lone sink,
portable appliance or bucket cannot identify the room. Prompts distinguish the
main photographed target from background surfaces. Visible hand-driven contact
or flowing water must accompany cleaning contact for an automatic `during` label.
An inactive tool or displayed cloth is not sufficient. One supporting hand does
not override an independently visible wiping hand.

The one bounded refinement request now also prioritizes automatic `during`
claims. A clear contradictory phase result holds the phase without discarding
the known object. Missing results/failures and manual changes retain their prior
behavior. There is still at most one six-image review request per batch; not every
image is guaranteed a second review when that budget is exhausted.

An intermediate candidate improved category coverage but wrongly held two actual
wiping photos and accepted two static-tool/part photos as work in progress; that
regression prompted the explicit action-evidence change. The latest same-set run
had category 19/19 accepted (19/22 coverage), space 5/5 (5/7), target 23/25 (25/25),
and phase 2/2 (2/28). The two independently labeled visible actions were retained;
no automatic action was assigned to the other phase-labeled pictures in this run.
It used seven successful requests in about 16.9 s. Two target errors remain.
Do not report these tuning-set figures as general accuracy or a completion gate.
An untouched subset, real before/after pairs and monthly-selection validation
remain necessary. The proposed fourth `site record` photo phase is not implemented
and still requires user preview approval.

### Additional two-site validation, 2026-10-12 (not release acceptance)

A systematic filename sample selected 24 images from two previously unused sites,
including two visits to one site. A phone-lockscreen image was excluded before any
provider call. Assistant reference labels for the remaining 23 were frozen before
predictions; uncertain target/category axes were not invented. This is a small
new-site check, not an independent expert benchmark. Once its results informed the
changes below, later runs on it became regression/tuning results, not fresh held-out
accuracy. The unused 12-image same-site sample was downloaded/inspected but not
sent to Gemini.

The first new-site run had baseline category 8/8, target 11/14, and phase 3/4
correct/accepted. Candidate category was 8/8, target 12/14, and phase 2/2. Four
images had positively labeled cleaning actions: the candidate missed two, while
the baseline missed one and additionally mislabeled displayed collected debris
as an ongoing action. One labeled common-corridor space was also misclassified.
No pair performance is implied by the classifier's empty pair list.

The prompt now follows the surface actually contacted by a hand/tool/water rather
than a prominent background appliance. An unrelated resting tool must not negate
an independently visible action. The desktop transport retains only a closed set
of six action-evidence tokens and valid action codes. Refinement distinguishes an
unknown second phase with the same visible action/target from contrary evidence:
it may preserve an already accepted first phase, but cannot promote an unknown
first phase. Inactive-tool evidence, different targets/actions, missing contact,
and manual choices retain their safeguards. Unit tests exercise the real client
transport, not just raw Worker rows.

The last new-site regression run had category 8/8, target 14/14, space 1/1 and
phase 3/3 correct/accepted (three of four known actions retained). Five successful
provider requests took about 12.1 s, excluding acquisition/preparation. However,
the original 30-image regression then had category 20/20, target 24/25 and phase
2/4: a held wet filter and a static filter beneath a tap were incorrectly accepted
as active cleaning despite the negative prompt. These are outstanding recognition
regressions, not grounds to change the reference labels or report completion.

Actual monthly-selection integration on 11 images from two visits completed in
two successful requests (~6.8 s) using the Worker's default vision model. It kept
three relevant photos from each date, emitted neutral closed captions, and did
not claim cleaning completion. This establishes one successful two-visit test,
not installed-app, authentication or monthly-PDF end-to-end verification.

Actual pair integration completed with six images in one request (~2.3 s), but
recommended two unsupported window pairs. One pair had visibly different fixed
window/railing structures; another lacked a verified surface improvement and has
now been sent to the user for a site-grounded reference decision. It is not an
independently confirmed false pair. A
possible platform before/after reference was provisional, not owner-confirmed,
and was not matched. Pair recognition is therefore **not accepted**. The app still
requires user confirmation; do not present AI pairs as verified before/after.

Outstanding gates: resolve the negative-action regressions and false window
pairs, validate against a new frozen reference after further tuning, obtain an
owner-confirmed positive before/after example, and obtain the optional fourth
photo-phase preview decision. No deployment, production rule update or model
configuration change has been performed by these local checks.

### Literal action observations and capture-date isolation

The provider now records closed `contact` and `water` observations before claiming
an action. Holding/supporting a component, droplets on a glove and a wet surface
cannot satisfy the action gate without actual wiping/tool operation or a visible
jet/spray reaching the target. The abstract `active_hand_contact`/`water_flow`
tokens alone are no longer enough. Missing/unsupported observations fail closed;
known category/target information remains available.

The subsequent original-set run kept both known wiping actions and rejected all
26 phase-labeled non-actions. Category was 20/20 accepted, space 6/6 and target
22/25; target recognition still varies and is not perfect. The 23-image set kept
two of four known actions, with no false automatic action on the other labeled
photos; category 7/7 accepted, target 11/14. These are regression samples, not
independent new acceptance results. Additional action precision costs recall.

A bounded 12-image in-memory model-capability experiment used the current prompt
and normalizer with the existing monthly model, without changing production
configuration or the classification model allowlist. It used five successful
calls including a six-image pair check. Classification/refinement took about
32.3 s, accepted 3/3 actions (of five known), target 11/12 and category 5/5. It
returned no window pairs, but also did not identify the provisional platform
candidate. This does not justify a production model switch; none was made.

Both move-in and common-area comparison groups now isolate known EXIF-original
capture dates and offsets; undated images form a separate group. Pair application
rejects incompatible known dates/offsets and reverse/equal capture times. Main
also rejects a mixed-visit comparison before sending any provider request. The
common-area renderer now preserves the returned bounded capture metadata, and
the capture module loads before the plan module. No actual date, filename, GPS
or EXIF text is sent to the classification provider; comparison retains only the
existing same-day relative-minute field. Manual pair editing is unchanged.

A real pipeline check used original EXIF, common-area grouping, the Worker,
desktop response normalization and pair application. It separated a later-visit
window but still recommended the same-day ambiguous pair. A same-style window
pair is not treated as a verified positive or negative until the user confirms
the site reference. Prompt refinements alone did not establish pair accuracy.

Seventeen further original photos were inspected locally (one bounded download
failed and one phone-lockscreen image is not suitable for provider evaluation).
No new confirmed before/after pair was found and none of these additional photos
has been sent to Gemini. A two-image contact sheet was shown to the user to ask
whether the ambiguous pair is actually one window before/after or different
windows. Original images and frozen labels remain unchanged. The separate fourth
`site record` phase choice remains unanswered and is not implemented.

### Coarse-time boundary and offline verification

An integration audit found that the Worker rejected equal `captureMinute` values
as equal capture times. The desktop deliberately rounds relative minutes down,
so two originals taken 30 seconds apart both have value zero. The Worker now
rejects a strictly reversed minute order, while retaining the same visible-change,
two-distinct-anchor and score requirements. Both report plans still reject exact
equal/reversed original seconds and incompatible visits. This does not infer
before/after from time or allow time-only evidence.

A new regression test failed on the previous Worker and passes after the fix.
The cross-component test starts with synthetic JPEG original-time metadata, uses
the real relative-minute encoder and Worker normalizer, and applies results to
both common-area and move-in plans. A forward sub-minute pair is retained; exact
equal/reversed originals and time-only suggestions remain excluded. This proves
the time contract, not visual recognition on a real confirmed pair.

Current offline verification: desktop suite 2,900 tests (2,898 pass, 2 existing
skips); Worker suite 223/223 pass. The actual renderer QA passed common-area,
move-in and responsive-layout scenarios, including during-only drafts, unresolved
photo retention, manual changes across retries, report save confirmation, escaping,
provider failure and stale-kind guards. Renderer fixtures are synthetic and do not
prove installed-app login, provider recognition or production behavior. No extra
paid model calls, model switch, installer build or deployment were performed for
this boundary fix. The site-grounded pair reference and real-photo accuracy gates
above remain open; passing offline tests does not close them.

### Existing-area evidence coverage and unresolved action review

Inspection of the actual work photos and current category contracts found that
`복도·공용 바닥` required an indoor corridor token, and `조명·천장` required a light
fixture. The normalizer now also recognizes a visibly bounded open walkway plus
its floor, and a visible overhead ceiling surface respectively. These are closed
observations within the existing categories, not new report items or a new photo
phase. A bare floor closeup, sky, wall or ambiguous scene still cannot supply these
observations. A visible ceiling maps to `other`, not `wall`; phase/action evidence
remains separate. Tests reproduced the previous rejection before the changes.

A real 23-image regression then recovered the open-walkway category, with 8/8
accepted category labels and 14/14 targets matching the frozen references, but
retained only two of four known actions. It revealed another integration gap:
a known category with an observed action but unknown phase was excluded from
refinement because `needsReview` only described category/target uncertainty.
Such an unresolved observed action now participates in the same one-request,
six-image budget. Static scenes without action are not all re-analyzed. Missing
responses, manual choices, non-work photos and contradictory categories retain
their guards. If refinement identifies a document/screen, it holds the placement
instead of silently retaining the earlier area guess.

The subsequent current-code runs used five successful requests for 23 images
(~11.2 s), and seven for the original 30 (~20.0 s). New-site category was 8/8;
target 13/13 accepted with one abstention; phase 2/2 accepted out of four positive
actions. Original-set category was 16/17 accepted, target 23/25, space 6/6 and
phase 2/2. A stair landing was called a common floor, and two target disagreements
remain. The new refinement eligibility is contract-tested but this stochastic run
did not establish improved action recall. No frozen references were changed.
These are regression/tuning measurements, not an independent accuracy claim.

Applying the new-site responses through the real common-area plan and report core
placed the entrance and external-floor actions in their respective draft items
with status `recorded`, kept 21 unresolved photos in the selection and left report
progress at zero. The remaining photos must not be silently called completed or
work-in-progress. Their optional fourth `site record` destination is still awaiting
preview approval. The ambiguous real window pair still needs a site-grounded
reference; neither a positive nor negative reference is invented.

Current offline verification after these edits: desktop 2,901 tests (2,899 pass,
2 existing skips), Worker 225/225, and all three actual-renderer scenario groups
passed. No deployment, production model configuration, API credentials, report
category names or live database rules were changed.

Offline JSON structure (no images or secrets):

```json
{
  "labels": [{"id":"sample-a","category":"aircon","space":"unknown","target":"aircon","phase":"during","scene":"scene-a"}],
  "baseline": {"classifications":[{"id":"sample-a","category":"review","space":"unknown","target":"unknown","phase":"unknown"}],"pairs":[],"apiCalls":1,"durationMs":1200},
  "candidate": {"classifications":[{"id":"sample-a","category":"aircon","space":"unknown","target":"aircon","phase":"during"}],"pairs":[],"apiCalls":2,"durationMs":1800}
}
```

The values above are illustrative, not measured results. Run:

`node scripts/evaluate-photo-classification.cjs <local-evaluation.json>`

Review accepted precision **and** coverage/review rate per axis, false before/after
pairs, measured elapsed time and provider-call count. Do not select thresholds on
the same examples used to claim accuracy, or improve precision by rejecting all
photos. Inspect false confident assignments individually before rollout.

## Rollout boundary

Implementation approval is not deployment authorization. The Worker, desktop app
and the move-in `during`/`recorded` validation schema need coordinated rollout.
No access-role grants change. Live rules still require explicit approval, a current
backup, rollback plan and Emulator role/anonymous-denial verification. Follow all
seven release steps in AGENTS.md when deployment is explicitly requested.
