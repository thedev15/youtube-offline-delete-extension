# Privacy

The extension reads the current watch URL, visible Downloads-sidebar rows and
native menu labels to identify the current video's offline removal action. The
experimental native-control path also creates YouTube's own download renderer
bound to the current/next video ID in the existing page. No helper tab or iframe.
It does not access account tokens, cookies, video files, browser download history,
private YouTube endpoints, browsing history outside the matching page, or your
filesystem. No telemetry, analytics, remote code or extension-initiated network
requests are included.

Only label and auto-advance preferences are saved through browser sync storage. A browser
provider may sync those preferences to your other devices if browser sync is
enabled. Video IDs and removal history are not stored by this extension.

Removal requires your explicit confirmation and is carried out through a native
YouTube control/menu. That native action may communicate with YouTube under YouTube's own
policies. This extension neither bypasses those policies nor downloads content.

The native adapter uses YouTube-generated UI state to check removal, not direct
storage access or media-byte inspection. Its check/status diagnostic excludes
video IDs/titles, account information, cookies and URLs.

Uninstalling the extension does not delete videos or YouTube downloads. Resetting
the label settings changes only extension preferences.