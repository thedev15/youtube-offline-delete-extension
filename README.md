# YouTube Offline Remove

A small, dependency-free WebExtension that adds **Remove download** beside the
video actions below a YouTube watch-page player—the area marked in the requested
design. It uses **YouTube's own Downloads-sidebar menu**, not private APIs or
direct deletion of browser storage.

**Offline playback limitation:** the live Edge watch-page Downloads sidebar has
been reported not to expose a native removal control. The current native-menu
adapter therefore does **not** provide verified offline in-player deletion.
Version **0.1.2** adds a **read-only “Check offline support”** button to test whether
the cached Downloads UI can load inside the player page. It opens no tab, does
not navigate the player, and performs no removal. An embedded view can be blocked
by YouTube's framing policy or fail to load from cache. This is a feasibility
check, not an offline-removal fix; synthetic fixtures do not prove live support.

## What it does

- Finds the current video by its exact 11-character watch URL ID.
- Requires its visible row in a sidebar titled **Downloads** and a native menu.
- Asks for explicit confirmation; Cancel/Escape make no removal request.
- Opens only that row's menu and clicks an exact Downloads-specific action.
- Reports success only after the current video's ID is absent from the recognized
  Downloads panel; a row merely being replaced/re-rendered is not enough. It never
  automatically retries.
- Plays the next Downloads row after verified removal, without opening Downloads.
  No next row means no navigation; failed removal never skips a video. This can
  be switched off in options (YouTube's own auto-advance is not disabled).
- Explains disabled states and provides a **Details** report with element counts
  and types, excluding video IDs/titles, URLs, cookies and account information.
- Handles YouTube SPA navigation, stale confirmations, duplicate rows, and narrow
  viewports. Styles are isolated in a shadow root; the dialog is keyboard-accessible.
- Defaults to English native labels. Exact translated titles/actions can be added
  in extension options. Generic `Delete`/`Remove` labels are rejected.

**No Downloads-page navigation is needed when the supported sidebar menu exists.**
If YouTube omits that menu or changes its layout, the extension disables the button
or reports that removal cannot be verified. It does not claim to support unknown
layouts, bypass YouTube Premium, or remove downloads via undocumented endpoints.
Your actual YouTube account/downloads were not accessed during development.

## Browser compatibility — honest boundaries

| Browser family | Package / status |
|---|---|
| Chrome, Edge, Brave, Opera and other desktop Chromium browsers | Chromium MV3 ZIP; actual unpacked-extension fixture tests run in Chromium. Each vendor's store and live YouTube integration still need validation. |
| Firefox desktop 140+ | Separate Firefox MV3 ZIP with Gecko ID and no-data-collection declaration. Firefox DOM fixture tests run in CI; these are not a signed-addon installation test. |
| Safari | Shared scripts get WebKit DOM fixture coverage. Requires conversion on macOS with Xcode, extension enablement and Safari-specific testing/signing. No ready-to-install Safari app is supplied. |
| Mobile browsers | Not certified. Most mobile browsers do not load desktop extensions, and native offline-download availability differs by platform. |

Browser support **does not create YouTube offline support** where YouTube doesn't
offer it. Engine fixture tests are not authenticated YouTube, physical-device,
store-review, or all-browser certification. See [the test plan](docs/TESTING.md).

## Build and install

Python 3.10+ is sufficient; no build dependencies or remote code are used.

```sh
python tools/build.py
```

Outputs: `dist/chromium/`, `dist/firefox/`, two versioned ZIPs and `dist/SHA256SUMS`.
Builds are deterministic, use an explicit file allowlist, and omit tests/secrets.

**Chrome / Edge / Brave / Opera (developer installation):** open the browser's
extension-management page, enable developer mode and choose **Load unpacked**,
selecting `dist/chromium`. Reload an existing YouTube tab. No store publication is
performed by this repository.

**Firefox (development):** open `about:debugging` → **This Firefox** → **Load
Temporary Add-on**, then select `dist/firefox/manifest.json`. Temporary addons are
removed on restart. Normal installation requires a Mozilla-signed package.

**Safari (macOS developer path):** install Xcode and run:

```sh
xcrun safari-web-extension-converter dist/chromium \
  --project-location dist/safari --app-name "YouTube Offline Remove"
```

Review converter warnings, build/run the generated app, enable the extension in
Safari and allow it on `www.youtube.com`. Public distribution needs Apple signing
and appropriate account/store setup. A WebKit test result alone is not Safari
extension certification.

## Use

1. Open a downloaded video's `/watch?v=…` page with the **Downloads** sidebar.
2. Click **Remove download** beside the video actions.
3. Confirm removal. Only the offline copy is targeted, not the creator's video.
4. After verified removal, the next Downloads video plays if available. Turn off
   the extension's auto-advance in options if you prefer to stay on the page.
5. If disabled, select **Details** and share its privacy-safe report. Check that
   the matching Downloads row has a native menu. For non-English YouTube,
   configure the exact sidebar title/action labels in options.

**Updating an unpacked Edge installation:** replace your existing unpacked folder
with the current Chromium build, then open `edge://extensions`, click **Reload**
on YouTube Offline Remove and refresh the YouTube tab. Confirm version **0.1.2**
on the extension's details page. Updating repository files alone does not update
an already-installed local copy.

Do not add generic destructive labels or attempt to force unsupported controls.
See [privacy](docs/PRIVACY.md) and [security](SECURITY.md).

### Read-only offline feasibility check (0.1.2)

1. Keep a downloaded video open in the player and disconnect from the internet.
2. Click **Check offline support**. A non-interactive embedded Downloads view
   appears inside the current page; the extension creates no helper tab.
3. Wait up to 15 seconds and copy the report. It exposes only capability flags,
   counts and element types, not video identifiers, titles, URLs or account data.
4. Close the check. No native removal action is clicked and playback is not
   advanced. A successful structure check is not proof of successful deletion or
   next-video offline playback. Those need a separate live, explicitly confirmed
   test after an adapter is implemented.

`browserReportsOnline` reflects the browser's connectivity hint, not proof that
the internet is unreachable. Disconnect the real network for a meaningful test.
The extension only reads the embedded DOM; YouTube manages its own page/cache
behavior. It does not bypass a framing block or access private storage schemas.

## Tests

```sh
node --test tests/shared.test.cjs
python -m pip install 'playwright==1.63.0'
python -m playwright install --with-deps chromium
python tools/build.py
python tests/browser_test.py --browser chromium --extension
```

CI runs unit/package checks, deterministic-build checks, Chromium/Firefox/WebKit
DOM fixtures and the actual unpacked Chromium extension. Browser evidence and ZIPs
are retained as GitHub Actions artifacts. All removals in automated tests affect
synthetic fixture rows; no real downloads are deleted.

## License and affiliation

MIT. Not affiliated with or endorsed by YouTube or Google. YouTube can change its
UI without notice; contributions should include a sanitized DOM fixture and
regression tests rather than account tokens or copied private endpoint requests.
