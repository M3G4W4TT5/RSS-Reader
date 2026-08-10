# Paywall Detection and Handling Plan

**Status:** Planning only — not implemented  
**Date:** 2026-08-10  
**Scope:** Source-add assessment, article-fetch completeness detection, indicators, settings, and retention of detection evidence

## 1. Recommendation

Add conservative, explainable paywall and partial-content classification in the trusted ingestion/extraction layer. Treat detection as probabilistic, show a clear indicator when content is likely incomplete, and preserve access to feed content plus **Open original**. Do not attempt to bypass paywalls, replay browser sessions, remove access controls, or present a teaser as a complete article.

Use two related assessments:

1. **Source assessment** during source creation or feed-URL replacement, based on feed metadata and a bounded sample of recent article pages.
2. **Article assessment** whenever a linked page is fetched and extracted, based on structured metadata, page text/DOM signals, response status, and content completeness comparisons.

The default should include sources and articles but label suspected restrictions. Users who prefer a fully retrievable library can change the setting to warn before adding or exclude strongly detected paywalled sources/articles.

## 2. Classification model

Keep access type separate from confidence:

| Status | Meaning |
|---|---|
| `none_detected` | No material paywall/partial-content signals were found |
| `registration_required` | Content appears gated by a free account/sign-in |
| `metered` | Some articles may be available until a usage limit is reached |
| `subscription_required` | A hard subscription/payment gate is strongly indicated |
| `partial_content` | The fetched body appears to be a teaser or truncated article, regardless of cause |
| `access_denied` | The server returned an authorization/payment response that prevents assessment |
| `unknown` | Evidence is insufficient or contradictory |

Store a confidence from 0–100 and stable reason codes. UI behavior should depend on both status and confidence:

- **0–39:** do not label as paywalled; retain diagnostics only;
- **40–69:** “May be incomplete” indicator;
- **70–100:** explicit “Paywall or sign-in detected” indicator and apply the selected handling policy.

Do not infer source-wide certainty from one article. Source status should summarize the sample, for example `2 of 3 sampled articles strongly gated`.

## 3. Evidence signals

### 3.1 Strong positive signals

- JSON-LD `isAccessibleForFree: false`.
- JSON-LD `hasPart` entries declaring paywalled CSS selectors.
- publisher metadata explicitly describing paid/subscriber content or content tier.
- a response status such as 402, or a 401/403 page whose body explicitly requests subscription/sign-in for the article.
- a dominant article-area gate with phrases such as “subscribe to continue reading,” “subscriber-only,” “already a subscriber,” or “sign in to read the full article.”
- a short extracted body followed by a gate inside the article container.

### 3.2 Supporting signals

- extracted text ends abruptly, lacks a closing paragraph, or is much shorter than declared `wordCount`.
- a feed summary promises materially more content than the linked extraction contains.
- an article body is hidden/blurred after a visible teaser.
- repeated subscription calls-to-action immediately adjacent to the extracted article.
- metadata or URL patterns indicating premium/subscriber editions.
- several recent articles from the same source show the same gate.

### 3.3 Negative/counter-signals

- extracted word count approximately matches credible structured `wordCount`.
- full article sections, conclusion, and normal footer boundary are present.
- feed-provided full content is longer and coherent even if the linked page is gated.
- the page contains a general subscription promotion only in navigation/footer, outside the article.

### 3.4 Signals that are insufficient alone

- any occurrence of “subscribe,” “member,” “premium,” or “sign in.”
- a short article.
- HTTP 403 without page evidence; it may be bot protection.
- a publisher appearing on a hard-coded reputation list.
- a failed Readability extraction.

These weak signals frequently occur on free sites and should not independently produce a paywall label.

## 4. Source-add assessment

After normal public-network validation and feed discovery succeed, assess at most three of the newest unique article URLs with bounded concurrency. This happens in trusted code before persistence when policy can reject the source.

Proposed sequence:

```text
Resolve and parse usable feed
  → inspect feed/source metadata
  → choose up to 3 newest public article URLs
  → bounded fetch with existing timeout, byte, redirect, and SSRF rules
  → collect paywall evidence without caching article bodies/images
  → aggregate source classification
  → apply Settings policy
  → atomically persist source and normal initial import, or return warning/rejection
```

Requirements:

- Do not fetch more than three sample pages.
- Do not fail source creation merely because sampling times out; classify `unknown` unless policy explicitly excludes unknown sources.
- Do not retain raw sampled HTML before the source exists.
- An invalid replacement feed URL still leaves the source unchanged.
- If policy excludes a strongly paywalled source, create no source, items, memberships, or fetch run.
- Existing source import overrides and collection creation must remain atomic with accepted imports.
- Bulk import continues after excluded/failed rows and reports `excluded_paywall` separately from technical failure.

Source assessment should be refreshed occasionally from actual article results rather than repeatedly sampling on every feed fetch.

## 5. Article-fetch assessment

Run detection on the original fetched DOM before Readability removes gate elements, then combine it with post-extraction evidence.

Proposed sequence:

```text
Fetch linked page
  → capture response and structured metadata
  → inspect article-area gate/truncation signals
  → run Readability and existing relevance cleanup
  → compare extracted/feed/declared lengths
  → classify access and completeness
  → sanitize/cache permitted content and images
  → store reason codes and confidence
```

Important distinctions:

- A technically successful Readability result can still be `partial_content`.
- A gated linked page may still have complete feed-provided content; show the feed version and state that the website is gated without calling the visible content incomplete.
- Bot protection, consent pages, regional denial, and generic fetch failure need separate error categories from paywall detection.
- Metered access may vary between requests. Record the result observed at fetch time and avoid claiming permanent source status.
- Retrying should be user-driven or follow normal cache policy; do not hammer a gate.

## 6. Settings design

Add a **Paywalls and partial articles** subsection, preferably within the existing Import and fetch section initially.

### Source import

**Include paywalled sources** with three modes:

- **Include and label** — default; add the source and label detected restrictions.
- **Ask before adding** — show sample evidence and require confirmation for confidence ≥ 70.
- **Exclude strongly detected** — reject confidence ≥ 70; allow suspected/unknown with a notice.

Optional control:

- **Sample articles when adding a source** — on by default; off skips network sampling and uses feed metadata only.

### Article handling

**Include paywalled or partial articles** with three modes:

- **Include and show available content** — default; retain feed/extracted teaser and label it.
- **Metadata only** — keep item metadata and original URL but discard gated body/images.
- **Hide from normal lists** — retain the item but exclude it unless a Paywalled filter is selected.

Additional controls:

- **Show suspected partial-content warnings** — on by default.
- **Retry unknown access failures automatically on next manual fetch** — off by default.
- Read-only counts: detected sources, strongly gated articles, suspected partial articles, and unknown assessments.

Settings copy must say detection is imperfect and the application will not circumvent publisher access controls.

## 7. User experience

### Add/edit source dialog

- Show “Checking recent articles for access restrictions…” after feed resolution.
- For strong detection, show status, sampled count, short reasons, and the effect of the current setting.
- In Ask mode, offer **Add and label** or **Cancel**. Do not use ambiguous “Continue.”
- For unknown sampling, allow normal add with “Could not determine access” unless excluded by an explicit policy.

### Reader

Place a compact notice near the existing extraction status:

- **Paywall detected — showing the content available from the feed.**
- **Sign-in required — this may not be the full article.**
- **This article may be incomplete.**
- **Access could not be determined.** (only when relevant to a failed/partial fetch)

The notice should include **Open original** and, where useful, **Why this is shown** with human-readable reasons. It must not suggest that Retry will bypass a subscription.

### Lists and navigation

- Add an accessible lock/badge icon to affected item rows.
- Add a Paywalled filter only if the Hide policy is implemented.
- Tooltips and screen-reader labels must distinguish confirmed/high-confidence from suspected.

## 8. Proposed persistent changes (future implementation)

Create a new migration; do not edit migrations `0001`–`0006`.

Proposed source fields:

- `paywall_status text not null default 'unknown'`;
- `paywall_confidence integer` with 0–100 constraint;
- `paywall_reasons jsonb not null default '[]'`;
- `paywall_sample_size integer not null default 0`;
- `paywall_checked_at timestamptz`.

Proposed item fields:

- `access_status text not null default 'unknown'`;
- `content_completeness text not null default 'unknown'` (`complete`, `partial`, `unknown`);
- `access_confidence integer` with 0–100 constraint;
- `access_reasons jsonb not null default '[]'`;
- `access_checked_at timestamptz`.

Proposed settings fields:

- source inclusion mode;
- source sampling boolean;
- article inclusion mode;
- suspected-warning boolean;
- automatic unknown retry boolean.

Prefer stable reason-code arrays plus bounded evidence values over storing copied gate text or raw HTML. Update database TypeScript types, repositories, and IPC contracts in the same implementation increment.

## 9. Detection component design

Add a pure `packages/feeds` detector that accepts already-fetched evidence and returns:

```ts
interface AccessAssessment {
  status: 'none_detected' | 'registration_required' | 'metered' |
    'subscription_required' | 'partial_content' | 'access_denied' | 'unknown';
  completeness: 'complete' | 'partial' | 'unknown';
  confidence: number;
  reasons: Array<{code: string; weight: number; detail?: string}>;
}
```

Keep fetching, URL policy, persistence, and Settings orchestration outside this pure detector. Use explicit weighted rules rather than an opaque model so tests and UI explanations are deterministic. Clamp repeated signals from the same page region so duplicated subscription markup does not inflate confidence.

Do not use an LLM/API for core detection. It would add cost, privacy, nondeterminism, and an external dependency to a problem with useful structured signals.

## 10. Security, ethics, and publisher controls

- Never remove or bypass access controls to obtain hidden content.
- Never send publisher cookies, browser profiles, saved logins, or Electron session state through the article fetcher.
- Never execute publisher JavaScript to reveal gated text.
- Continue validating submitted, redirect, sample, and article URLs against the public-network policy.
- Treat paywall DOM/text as untrusted input and sanitize all displayed evidence.
- Do not log raw page HTML or lengthy gate text.
- Respect existing timeouts, byte limits, and bounded concurrency.
- Keep Open original in the system browser so the user can authenticate directly with the publisher if entitled.

## 11. Accuracy and recalibration

Persist aggregate reason counts locally so false positives can be diagnosed without raw content. Provide a future **Report incorrect label** action that lets the user override an article/source assessment locally. Overrides must be distinct from detector output and survive re-fetches unless the user clears them.

Measure:

- precision of strong detection;
- suspected-to-confirmed conversion;
- false positives on short free articles and subscription-promoted sites;
- unknown rate;
- source-add latency from sampling;
- percentage of gated pages with complete feed fallback.

Favor precision over recall for exclusion. A missed label is less harmful than silently rejecting a usable source.

## 12. Validation plan

Future implementation should add deterministic fixtures for:

- JSON-LD `isAccessibleForFree: false`;
- `hasPart` paywall selectors;
- hard subscription gate after teaser;
- free registration/sign-in gate;
- metered-access messaging;
- full free article with unrelated newsletter subscription promotion;
- very short free article;
- HTTP 401/402/403 with and without paywall evidence;
- bot-protection and consent pages;
- complete feed body plus gated linked page;
- declared word count that agrees/conflicts with extraction;
- malformed metadata and hostile HTML.

Also validate:

- score thresholds and reason de-duplication;
- bounded three-page source sampling and partial failures;
- accepted/rejected source atomicity;
- bulk-import partial success and separate exclusion reporting;
- Settings schema boundaries and policy behavior;
- renderer indicators, accessible labels, Ask confirmation, and filters;
- existing extraction/image/security behavior remains unchanged;
- type checking, full Vitest, clean migration, Windows packaging, and focused packaged runtime smoke checks.

## 13. Delivery sequence

1. Approve statuses, confidence thresholds, and Settings defaults.
2. Add fixtures and the pure evidence detector.
3. Add the migration, schema types, contracts, and repositories.
4. Integrate article-fetch assessment before and after Readability.
5. Add reader/list indicators and handling policy.
6. Add bounded source sampling to single-source add/edit.
7. Extend bulk import reporting and Settings UI.
8. Collect false-positive evidence and recalibrate before enabling exclusion by default for any user.

## 14. Deferred decisions

- Publisher-specific adapters or allow/deny lists.
- Authenticated publisher integrations.
- User browser-session reuse.
- Cloud paywall reputation services.
- Automated subscription purchase or credential management.

The last four are outside the current prototype and should not be inferred from this plan.
