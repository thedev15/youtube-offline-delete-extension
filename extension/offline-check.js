/* Read-only feasibility probe. No deletion, clicks, tabs, storage writes or private APIs. */
(() => {
  "use strict";
  if (window.top !== window) return;
  const {videoId, normalize, extensionApi, sanitizeSettings, storage} = globalThis.YTOfflineRemove;
  let active = null;
  let settings = sanitizeSettings();
  storage("get", "ytOfflineRemoveSettings").then(value => {
    settings = sanitizeSettings(value.ytOfflineRemoveSettings);
  }).catch(() => {});
  const host = document.getElementById("yt-offline-remove-host");
  if (!host?.shadowRoot || host.shadowRoot.getElementById("offline-check")) return;
  const shadow = host.shadowRoot;
  const button = document.createElement("button");
  button.id = "offline-check";
  button.type = "button";
  button.textContent = "Check offline support";
  button.title = "Read-only test of cached Downloads controls inside this page. No removal or new tab.";
  shadow.insertBefore(button, shadow.getElementById("status"));
  function close() {
    if (!active) return;
    clearInterval(active.timer);
    active.overlay.remove();
    active = null;
    if (button.isConnected) button.focus();
  }
  function open() {
    if (active || !videoId(location.href) || shadow.querySelector("[role=dialog]")) return;
    const id = videoId(location.href);
    const originalRoute = location.href;
    const overlay = document.createElement("div");
    overlay.className = "backdrop";
    overlay.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="offline-check-title" style="max-width:760px;width:100%;max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box"><h2 id="offline-check-title">Read-only offline support check</h2><p>Disconnect from the internet before this test. The player stays on this page. The embedded Downloads view is non-interactive: this test cannot click a removal action. Copy the report below into the chat.</p><div id="offline-frame"></div><pre tabindex="0" aria-label="Offline support report"></pre><button id="offline-close" type="button">Close</button></section>`;
    const output = overlay.querySelector("pre");
    const report = {
      extensionVersion: extensionApi?.runtime?.getManifest?.().version || "development",
      check: "Read-only embedded Downloads UI; not a removal test",
      browserReportsOnline: navigator.onLine,
      frameAccessible: false,
      downloadsRouteLoaded: false,
      downloadsHeadingDetected: false,
      matchingCardCount: 0,
      matchingCardElementTypes: [],
      matchingCardMenuElementTypes: [],
      status: "Waiting for embedded Downloads view",
    };
    const render = () => {output.textContent = JSON.stringify(report, null, 2);};
    render();
    const frame = document.createElement("iframe");
    frame.title = "Read-only cached Downloads capability test";
    frame.tabIndex = -1;
    frame.inert = true;
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.style.cssText = "display:block;width:100%;height:180px;border:1px solid #8886;pointer-events:none;";
    frame.src = "https://www.youtube.com/feed/downloads";
    overlay.querySelector("#offline-frame").append(frame);
    shadow.append(overlay);
    const started = Date.now();
    const poll = () => {
      if (location.href !== originalRoute) {close(); return;}
      report.browserReportsOnline = navigator.onLine;
      try {
        const doc = frame.contentDocument;
        const url = doc && new URL(doc.URL);
        report.frameAccessible = Boolean(doc && url?.origin === location.origin);
        report.downloadsRouteLoaded = Boolean(report.frameAccessible && url.pathname === "/feed/downloads");
        if (report.downloadsRouteLoaded) {
          const titles = settings.panelTitles.map(normalize);
          report.downloadsHeadingDetected = [...doc.querySelectorAll("h1, h2, #title, #header yt-formatted-string, ytd-page-header-renderer yt-formatted-string")]
            .filter(node => !node.closest("ytd-rich-item-renderer, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model"))
            .some(node => titles.includes(normalize(node.textContent)));
          const cards = new Set([...doc.querySelectorAll("a[href]")].filter(link => videoId(link.href) === id)
            .map(link => link.closest("ytd-rich-item-renderer, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model")).filter(Boolean));
          report.matchingCardCount = cards.size;
          report.matchingCardElementTypes = [...new Set([...cards].map(card => card.localName))];
          report.matchingCardMenuElementTypes = [...new Set([...cards].flatMap(card => [...card.querySelectorAll("button, [role=button], yt-icon-button, ytd-menu-renderer, yt-button-view-model")]).map(node => node.localName))];
        }
        if (report.downloadsRouteLoaded && report.downloadsHeadingDetected && report.matchingCardCount === 1) {
          report.status = "Cached view structure detected; native removal and offline playback remain unverified";
        } else if (Date.now() - started >= 15000) {
          report.status = "Embedded view unavailable or unsupported; no removal or navigation attempted";
        }
      } catch {
        report.frameAccessible = false;
        report.status = "Embedded view inaccessible; no removal or navigation attempted";
      }
      render();
      if (Date.now() - started >= 15000) clearInterval(active?.timer);
    };
    active = {overlay, timer: setInterval(poll, 500)};
    const closeButton = overlay.querySelector("#offline-close");
    closeButton.addEventListener("click", close);
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); close();}
      if (event.key === "Tab") {
        event.preventDefault();
        (shadow.activeElement === closeButton ? output : closeButton).focus();
      }
    });
    closeButton.focus();
  }
  button.addEventListener("click", open);
  window.addEventListener("pagehide", close);
  document.addEventListener("yt-navigate-finish", () => {if (active) close();});
})();