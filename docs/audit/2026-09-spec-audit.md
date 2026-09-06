# Spec audit — September 2026

An audit of [docs/product-spec.md](../product-spec.md) run before implementation
started, across ten independent lenses.

## Status of this document

**The findings below are UNVERIFIED.** The audit ran eight of ten review lenses and
then hit a session limit before the adversarial verification stage could run. Every
finding here is one reviewer's claim that no sceptic has tried to refute.

Two lenses never ran at all: **data model** and **scale/operations**. Their findings
are absent, not empty.

Findings that have since been confirmed independently — by calculation or by being
resolved in code — are marked ✅. Treat the rest as leads.

| | |
|---|---|
| Lenses completed | 8 of 10 (missing: data model, scale/operations) |
| Findings recovered | 64 |
| Adversarially verified | 0 |
| Confirmed independently | 9 |

---

## Confirmed

These were checked by direct calculation or resolved during implementation.

### ✅ The level curve's time estimates are off by roughly an order of magnitude

Level 50 needs ~979,000 XP. At the spec's own 60 min/day that is 44.7 years, against
a stated "~2.5 years". Verified by computation.

**Resolved:** curve refitted to `floor(30 × n^1.15)`. See
[ADR 0001](../adr/0001-level-curve.md).

### ✅ The level table contradicts its own formula

Listed 1,174 for level 5→6 where the formula gives 1,313; ~150,000 cumulative for
level 26 against an actual 174,535. Verified by computation.

**Resolved:** the table is regenerated from the formula, and the time targets are
asserted in `leveling.test.ts`.

### ✅ The daily cap and the anomaly threshold cancel each other out

7 categories × 120 min/day = exactly 840 min = 14 hours. §4 Layer 3 flags anomalies
at "> 14 hours". A user farming every cap to the limit is never flagged.

**Resolved:** per-category caps now differ, a 6-hour global cap sits under them, and
the anomaly threshold moved to 8 hours. `scoring.test.ts` asserts the global cap stays
strictly below the sum of the category caps.

### ✅ XP → stat conversion was never defined

§3.3 calls stats "the thing that creates character identity" but no rule said how a
session becomes stat points. The 7-value `Category` enum had no mapping to the 6
stats; which stat `HEALTH` feeds was undefined.

**Resolved:** `CATEGORY_DEFAULT_STAT` and `CATEGORY_ALLOWED_STATS` in `balance.ts`.
Stats accumulate raw XP and the displayed value is derived — see the note on rounding
below.

### ✅ Two classes were never defined

§3.3 describes 4 classes; the §7 `ClassType` enum has 6. `RANGER` and `ARTISAN`
appear nowhere else. Several stat distributions mapped to no class at all.

**Resolved:** all six pairs defined in `CLASS_STATS`; `suggestClass` falls back to
best-scoring pair so every non-empty sheet resolves.

### ✅ `MANUAL_ENTRY` has a rule but no enum value

§4 Layer 1 defines manual entry as earning 30% XP. The §7 `Verification` enum has no
value for it, and §8 has no endpoint. The rule was unenforceable as written.

**Resolved:** added to the enum and to `VERIFICATION_MULTIPLIER`.

### ✅ Modifiers are defined in four places and never combined

The §3.1 formula has 4 multipliers. Elsewhere the spec defines class +10% (§3.3),
prestige +10% (§3.2), Focus Mode +20% (§10) and equipment +5% (§10). Stacked, the
compound multiplier reaches 5.4× before the ones still unimplemented.

**Resolved:** all modifiers pass through one formula, and `TOTAL_MULTIPLIER_CAP`
clamps the compound multiplier at 3.0.

### ✅ Sessions had no lifecycle

Nothing said who closes an abandoned session, what bounds its duration, whether the
server or the client measures it, or what stops a retry from awarding XP twice. A
forgotten timer would have blocked that user's next session permanently.

**Resolved:** server-side duration, `clientRequestId` idempotency, auto-abandon past
`MAX_SESSION_MINUTES`, single-active-session enforcement. All in
`modules/sessions/service.ts`.

### ✅ Storing only a running XP total makes corrections impossible

§7 stored XP as `User.totalXp` alone. The "shadow correction" enforcement §4
describes cannot be implemented against a single counter, and a wrong award cannot be
reversed.

**Resolved:** `XpLedger` is append-only and authoritative; `User.cycleXp` is a cache.

---

## Unverified findings

Recovered from the eight lenses that completed. No sceptic reviewed these.

### Anti-abuse and verification

- The server holds no evidence a session happened; the whole chain rests on the
  client timer being honest.
- "Start the timer and walk away" defeats all four layers — and three separate
  mechanics reward it.
- Layer 3 anomaly detection cannot run against the spec's schema: the signals it
  needs are not stored, and no model says who decides or how it is appealed.
- Shadow correction is a fully automated adverse decision with no notice and no
  appeal path — KVKK art. 11(g) and GDPR art. 22 territory.
- No defence against multi-accounting, mutual-approval rings, or duel throwing.
  Layer 4 delegates the verification standard to the guild being audited.
- `User.timezone` is user-editable and governs the daily cap, streaks and league
  weeks.
- The app is a full UGC platform (DMs, media posts, photo proof) with zero reporting,
  blocking or moderation — a direct App Store 1.2 rejection.

### Mobile platform reality

- "Screen off + no movement" (Layer 2) cannot be read from the background on iOS. The
  core anti-abuse signal may not be implementable.
- A 30–120 minute timer surviving backgrounding is never designed; `session:tick` over
  WebSocket is specifically the approach that will not work.
- Focus Mode's two halves — muting other apps' notifications, verifying the phone
  stayed locked — are both blocked by platform constraints.
- The spec references Google Fit, which no longer accepts new registrations as of
  September 2026.
- Offline use appears nowhere; starting and finishing a session both require network.
- The widget is classified "low cost" but is roughly 16 person-days across two native
  toolchains. "Bare workflow optional" is wrong — prebuild is required from day one.

### API and realtime

- No error format, HTTP status policy, validation error shape, versioning policy,
  rate limiting, or cursor format is specified.
- WebSocket has no authentication, room authorisation, reconnection, or horizontal
  scaling story.
- `session:tick` once per second is unnecessary cost on both the server and the
  user's battery.
- No endpoints for blocking, reporting, account deletion, data export, push token
  registration, or notification preferences.

### Legal and privacy

- Heart rate and step data are special-category personal data under KVKK art. 6;
  the spec treats them as ordinary "device signals". Using them for cheat detection
  also strains Apple/Google platform policy.
- §13 promises a data deletion endpoint; §8 has none and the schema makes deletion
  impossible.
- No privacy notice, consent flow, analytics-tracking consent, or retention periods.
  "Explicit consent" appears once in 571 lines, inside a risk table cell.
- "TR data residency" is not achievable with the proposed stack, and framing it that
  way hides the actual obligation (KVKK art. 9 cross-border transfer).
- The product's cultural signals will attract 13–18 year olds. No age gate, no
  parental consent, no field in the schema that could establish age.
- Photo proof has no retention period, access control, or deletion path.

### Product and retention

- The entire onboarding rests on an uncited "4-5× retention" correlation, and it
  contradicts the spec's own cold-start risk: a friend-first first screen has nobody
  to add on day one.
- The §12 targets cannot be measured to statistical significance in a 50-person
  closed beta, and the "month 3" timing does not match the roadmap.
- Monetisation is one word in Phase 4. Selling XP would destroy the product's core
  claim; no rule prevents it.
- §5.1 solves a feed-spam problem its own metrics say will not exist (roughly 1 post
  per day), and the feed scoring formula is unnormalised.
- Eight concurrent competitive/obligation layers, four on the same weekly cadence.
  Their combined notification demand exceeds the spec's own 3-per-day cap.
- "No punishment" is stated while at least four punishment mechanics are specified;
  league relegation alone is claimed at ~90% probability per season.

### Roadmap, scope and stack

- The 22-week roadmap budgets roughly a third of the real work for one developer.
- Anti-abuse — declared "not optional, a core feature" — appears in no phase.
- "General release" at the end of Phase 3 is not possible under Play's 12-tester /
  14-day requirement and App Store 1.2 moderation rules.
- Leagues cannot function in Phase 2: 5 tiers × 30 people needs 150 weekly actives
  against a planned 5–10. The 7-promote / 5-relegate split is also unstable.
- Clerk is chosen but `User` has no field for the Clerk id; the claimed "3 weeks
  saved" nets out closer to 1.8.
- "Express is in maintenance mode" is factually wrong; the Fastify decision rests on
  a bad premise.

### Internal consistency

- `streakCarpani` saturates on day 50; the product's strongest retention lever stops
  rewarding anything after seven weeks.
- Which streak the multiplier reads is undefined — the schema stores it per habit,
  the formula and UI read as per user.
- §5.1 gives a feed ranking formula and then says not to use it; the actual default
  behaviour (daily digest posts) cannot be represented in the schema.
- `GET /leaderboard/global` and `@@index([totalXp desc])` exist while §10 advises
  against public global rankings.
- "Streak freezing" is offered twice as the humane alternative to punishment and
  never defined.

---

## Found during implementation

Not in the audit — surfaced by running the seed script against real data.

### ✅ Per-session stat rounding discarded short sessions

Awarding `floor(xp / 20)` stat points per session meant anything under 20 XP granted
nothing. A 15-minute meditation earns ~18 XP, so a user meditating daily for two
weeks gained **1 WIS**. The seed made this visible immediately.

**Resolved:** stats accumulate raw XP (`strengthXp`, `wisdomXp`, …) and the displayed
value is derived via `statPointsFromXp`. Nothing is lost, and `STAT_POINT_DIVISOR`
becomes a pure display knob that can be retuned without migrating data. Regression
test in `stats.test.ts`.

---

## Completing this audit

The audit script is preserved and can be resumed:

```
Workflow({
  scriptPath: ".claude/.../habit-war-doc-audit-wf_cfdc9010-8cb.js",
  resumeFromRunId: "wf_cfdc9010-8cb"
})
```

Completed agents return cached results, so a resume re-runs only the verification
stage, the two missing lenses, and the synthesis.
