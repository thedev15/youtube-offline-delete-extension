# Validation and release gates

## Automated

- Node built-in tests: URL/origin constraints, label normalization and bounds,
  generic destructive-label rejection, callback/Promise storage, storage errors,
  and minimum-permission manifests.
- Twenty-three DOM scenarios per browser engine: action-row placement; Cancel; exact
  confirmed removal; focus trap/Escape; SPA routing; stale confirmation; missing
  sidebar; unrelated playlist; duplicate rows; generic/ambiguous native actions;
  unverified removal with no retry; row disappearance during confirmation;
  non-watch URLs; narrow viewport dialog; privacy-safe disabled-state diagnostics;
  class-based Downloads heading; missing native menu; icon/button wrappers;
  modern list-item action; no duplicate native auto-advance; last-download behavior;
  re-rendered row not mistaken for deletion. Verified removal tests also check
  next-video navigation, while failure tests check that no next-video click occurs.
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
12. Edge: verify version 0.1.1 after reloading the unpacked extension and refreshing
    YouTube. A disabled button must explain the condition and offer Details; its
    report must not contain account information, video IDs/titles or URLs.

This initial version is a reviewed/tested **preview**, not a claim that every
YouTube deployment has matching menu renderers. Unsupported layouts need a new
sanitized fixture and adapter, not broad/global matching of Delete buttons.

## Publishing

The implementation can be pushed as a PR without removing user data. Store
submissions are separate: Chrome Web Store/Edge Add-ons, Mozilla signing, and Apple
signing each need the owner's accounts and live-browser verification. Do not
auto-publish a release because fixture CI is green alone.