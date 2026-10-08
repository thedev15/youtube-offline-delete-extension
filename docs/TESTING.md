# Validation and release gates

## Automated

- Node built-in tests: URL/origin constraints, label normalization and bounds,
  generic destructive-label rejection, callback/Promise storage, storage errors,
  and minimum-permission manifests.
- DOM scenarios per browser engine: action-row placement; Cancel; exact
  confirmed removal; focus trap/Escape; SPA routing; stale confirmation; missing
  sidebar; unrelated playlist; duplicate rows; generic/ambiguous native actions;
  unverified removal with no retry; row disappearance during confirmation;
  non-watch URLs; narrow viewport dialog; privacy-safe disabled-state diagnostics;
  class-based Downloads heading; missing native menu; icon/button wrappers;
  modern list-item action; no duplicate native auto-advance; last-download behavior;
  re-rendered row not mistaken for deletion. Verified removal tests also check
  next-video navigation, while failure tests check that no next-video click occurs.
- Native-control prototype fixtures: missing watch-sidebar menu, read-only
  preparation, explicit confirmation/Cancel, current-ID checks, native-label
  state transition, non-downloaded target refusal, unverified removal without
  retry/navigation, and non-downloaded next-video refusal. No iframe/new tab.
  Programmatic confirmation is rejected: MAIN requires a trusted user click.
  Document-event transport is tested with window messages blocked, explicit
  other-video rejection, and acknowledgement/stage diagnostics with private
  identifiers excluded. This simulates message interference, not a proven root
  cause of the live v0.1.3 Edge timeout.
  Structural snapshots test empty renderer and recognized removal label without
  an eligible click target. Unsupported checks remain disabled, make zero native
  clicks/navigation and retain only booleans/counts captured before cleanup.
  Target-ownership fixtures include an unrelated first candidate, hidden/disabled
  duplicate removal targets, two eligible removal targets, a disabled/hidden
  target or native wrapper, nested target ambiguity, unowned removal label, and
  a new ambiguity appearing during confirmation. Only one eligible exact-label
  owner may be selected; unrelated handlers must never execute. The unique
  selection is revalidated immediately before the confirmed click.
  The fixture deliberately implements a synthetic renderer lifecycle. It does
  NOT establish that creating/data-binding this renderer works on live YouTube.
- Chromium uses a real unpacked extension in a fresh temporary browser profile
  under `test-results/`. Firefox/WebKit tests inject the exact scripts with a
  mock extension-storage interface; this validates DOM code, not addon APIs/loading.
- Browser requests to `https://www.youtube.com/**` are fulfilled by a local fixture.
  No live signed-in YouTube or downloads are touched. Failure reports/screenshots
  and success JSON are written under `test-results/` and archived by CI.
- Build allowlist, syntax checks and identical hashes across repeated builds.

## Required live checks before calling this production-ready

Using a disposable download you explicitly consent to removing:

1. Install the appropriate package in your real desktop browser. Reload YouTube.
2. Open the Downloads-sidebar playback layout shown in the requested screenshot.
3. Verify placement beside the video action row, including zoom and light/dark mode.
4. Confirm the button is enabled only for the current video's supported native menu.
5. Cancel: offline copy remains. Confirm: the correct copy disappears, another
   downloaded video remains, the next Downloads video plays when available, and
   no visit to `/feed/downloads` occurs. Test the last download and the options
   toggle: extension auto-advance must stop when disabled, without attempting to
   suppress YouTube's own behavior.
6. Test SPA next/previous videos, focus, keyboard, and browser back/forward cache.
7. Test actual YouTube errors and any native secondary confirmation: the extension
   must not claim success or retry if row removal isn't observed.
8. For each language, validate exact translated labels. Unknown labels must fail closed.
9. Firefox: test actual unsigned development addon loading and then Mozilla signing.
10. Safari: use macOS conversion/build, enable permissions, and test the actual addon.
11. Check the browser's native YouTube download availability; unsupported browsers
    cannot gain native offline support from this extension.
12. Edge: verify version 0.1.6 after reloading the unpacked extension and refreshing
    YouTube. A disabled button must explain the condition and offer Details; its
    report must not contain account information, video IDs/titles or URLs.
13. In the live offline player without a sidebar menu, run **Check native control**
    with the actual network disconnected. The check must make zero native clicks.
    If unsupported/not-downloaded, stop and share Details; do not guess action
    fields, bypass access controls, delete storage records or open a helper tab.
14. If the native control is ready, select a disposable current download and
    explicitly confirm. Independently verify its absence from Downloads and that
    the next video plays with the network still off. A label transition—even
    from two native controls—is UI evidence, not independent media-byte proof.
    Check late native errors, stale cache and changing current/next IDs before
    describing the prototype as a working offline deletion implementation.

This initial version is a reviewed/tested **preview**, not a claim that every
YouTube deployment has matching menu renderers. Unsupported layouts need a new
sanitized fixture and adapter, not broad/global matching of Delete buttons.

## Publishing

The implementation can be pushed as a PR without removing user data. Store
submissions are separate: Chrome Web Store/Edge Add-ons, Mozilla signing, and Apple
signing each need the owner's accounts and live-browser verification. Do not
auto-publish a release because fixture CI is green alone.