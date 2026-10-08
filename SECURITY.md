# Security policy

Report safety bugs privately to the repository owner. Do not post account tokens,
cookies, signed URLs, real download contents, or private YouTube request captures.

Safety invariants:

- Explicit confirmation before any native removal request. The experimental
  MAIN-world adapter additionally requires a fresh trusted click in the extension
  confirmation dialog; a bridge message/programmatic click alone is insufficient.
- Same current video ID revalidated before clicking. Native path additionally
  checks the bound control's endpoint ID and removal label immediately before
  dispatch. Legacy sidebar path checks the same unique row.
- Native path requires YouTube-generated exact English removal labels; legacy
  path requires a configured exact label in that row's visible popup. No generic
  global Delete matching, guessed method arguments or action fields.
- Missing/ambiguous controls fail closed. No automatic deletion retry.
- Native path verifies a transition to Download on the clicked and freshly
  constructed current-ID controls. This is native UI evidence only, not proof
  of deleted media bytes. Next navigation additionally requires a fresh native
  downloaded-state indication for the next ID. Legacy path checks target-ID
  absence from its recognized panel. A sent click/rerender alone is not proof.
- No private APIs, credential extraction, filesystem deletion, permission expansion,
  analytics or third-party JavaScript dependencies.

YouTube's live DOM is outside this project's control. The legacy adapter supports
`ytd-playlist-panel-renderer`, `ytd-playlist-panel-video-renderer`,
`ytd-menu-popup-renderer` and `ytd-menu-service-item-renderer`. A future layout may
need a new adapter. Keep matching narrow and add an offline regression fixture
before expanding support.

The experimental `ytd-menu-service-item-download-renderer` adapter depends on an
unverified live component lifecycle outside its normal menu. MAIN-world code and
open shadow DOM share YouTube's page trust boundary; they are not a security
boundary against a malicious first-party page. The bridge exposes no additional
extension privileges, credentials, storage-deletion API or network endpoint.
Live offline testing with a consented disposable copy is a release gate.

Version 0.1.4 extension requests use named document events with JSON-string
payloads, length bounds and nonce matching. These events are not an authentication
boundary against the first-party page. The same trusted-confirmation gate and
exact current-video validation apply to both document events and retained legacy
message diagnostics. No automatic removal retries or transport fallback.
Startup/stage attributes contain only fixed version/stage values, not identifiers.