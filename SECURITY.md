# Security policy

Report safety bugs privately to the repository owner. Do not post account tokens,
cookies, signed URLs, real download contents, or private YouTube request captures.

Safety invariants:

- Explicit confirmation before any native removal request.
- Same current video ID and same unique Downloads row revalidated before clicking.
- Removal action must match a configured exact Downloads-specific label inside a
  visible native popup opened from that row; no generic global Delete matching.
- Missing/ambiguous controls fail closed. No automatic deletion retry.
- Success requires the target row to disappear; a sent click is not proof.
- No private APIs, credential extraction, filesystem deletion, permission expansion,
  analytics or third-party JavaScript dependencies.

YouTube's live DOM is outside this project's control. The present adapter supports
`ytd-playlist-panel-renderer`, `ytd-playlist-panel-video-renderer`,
`ytd-menu-popup-renderer` and `ytd-menu-service-item-renderer`. A future layout may
need a new adapter. Keep matching narrow and add an offline regression fixture
before expanding support.