(() => {
  "use strict";
  if (window.top !== window) return;
  if (document.getElementById("yt-offline-remove-host")) return;
  const {normalize, videoId, sanitizeSettings, storage, extensionApi} = globalThis.YTOfflineRemove;
  const PANEL_SELECTOR = "ytd-playlist-panel-renderer";
  const ROW_SELECTOR = "ytd-playlist-panel-video-renderer";
  const HEADER_SELECTOR = "#header #title, #header-title, #playlist-title, #header .title, #header yt-formatted-string, h1, h2";
  const MENU_BUTTON_SELECTOR = "ytd-menu-renderer button, ytd-menu-renderer yt-icon-button, yt-icon-button#menu, #menu button, button[aria-haspopup='true'], button[aria-haspopup='menu']";
  let settings = sanitizeSettings();
  let busy = false;
  let scheduled = false;
  let modal = null;
  let route = location.href;
  let notice = "";
  let nativeState = {status: "unchecked", reason: "Native control has not been checked."};
  let probing = false;
  const CHANNEL = "yt-offline-native-control-v1";
  const REQUEST_EVENT = "yt-offline-native-request-v2";
  const RESPONSE_EVENT = "yt-offline-native-response-v2";
  let bridgeState = {transport: "document-json-event", requestAcknowledged: false, replyReceived: false};
  function nativeRequest(operation, id, nextId = null) {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    bridgeState = {transport: "document-json-event", requestAcknowledged: false, replyReceived: false};
    return new Promise((resolve, reject) => {
      const listener = event => {
        if (event.target !== document || typeof event.detail !== "string" || event.detail.length > 4096) return;
        let data;
        try {data = JSON.parse(event.detail);} catch {return;}
        if (data?.channel !== CHANNEL || data.nonce !== nonce || data.videoId !== id) return;
        if (data.direction === "acknowledgement") {bridgeState.requestAcknowledged = true; return;}
        if (data.direction !== "response") return;
        bridgeState.replyReceived = true;
        clearTimeout(timer); document.removeEventListener(RESPONSE_EVENT, listener, true); resolve(data);
      };
      const timer = setTimeout(() => {
        document.removeEventListener(RESPONSE_EVENT, listener, true);
        reject(new Error(bridgeState.requestAcknowledged ? "Native adapter acknowledged the request but did not complete it. No retry or navigation." : "Native adapter did not acknowledge the document-event request. No retry or navigation."));
      }, 15000);
      document.addEventListener(RESPONSE_EVENT, listener, true);
      try {document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {detail: JSON.stringify({channel: CHANNEL, direction: "request", nonce, operation, videoId: id, nextVideoId: nextId})}));}
      catch {
        clearTimeout(timer); document.removeEventListener(RESPONSE_EVENT, listener, true);
        reject(new Error("Document-event dispatch failed. No retry or navigation."));
      }
    });
  }
  async function checkNative() {
    const id = videoId(location.href);
    if (!id || busy || probing || modal) return;
    probing = true;
    notice = "";
    nativeState = {status: "checking", reason: "Checking YouTube's native download control without clicking it…"};
    update();
    try {
      const result = await nativeRequest("probe", id);
      if (videoId(location.href) === id) nativeState = result;
    } catch (error) {if (videoId(location.href) === id) nativeState = {status: "failed", reason: error.message};}
    finally {probing = false; update();}
  }
  const host = document.createElement("div");
  host.id = "yt-offline-remove-host";
  host.style.cssText = "display:inline-flex;align-items:center;margin-inline:8px;max-width:100%;";
  const shadow = host.attachShadow({mode: "open"});
  shadow.innerHTML = `<style>
    :host{font:14px/1.4 system-ui,sans-serif;color:var(--yt-spec-text-primary,#111)}
    button{font:inherit;cursor:pointer;border:1px solid #8886;border-radius:22px;padding:9px 14px;background:var(--yt-spec-badge-chip-background,#8882);color:inherit;white-space:nowrap}
    button:hover{background:#8883}button:focus-visible{outline:3px solid #3ea6ff;outline-offset:3px}
    button:disabled{opacity:.55;cursor:default}.danger{background:#b3261e;color:#fff}.danger:hover{background:#901f18}
    .status{max-width:260px;font-size:12px;margin-inline-start:8px;overflow-wrap:anywhere}
    #details{font-size:12px;padding:6px 10px;margin-inline-start:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;font:12px/1.4 monospace}
    .backdrop{position:fixed;inset:0;background:#0009;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
    .dialog{background:var(--yt-spec-base-background,#fff);color:var(--yt-spec-text-primary,#111);border:1px solid #8886;border-radius:16px;padding:24px;max-width:420px;box-shadow:0 8px 40px #0007}
    h2{font-size:20px;margin:0 0 12px}p{white-space:normal;margin:10px 0 18px}.buttons{display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap}
    @media(max-width:700px){.status{max-width:160px}.dialog{padding:18px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
    @media(forced-colors:active){button{border:1px solid ButtonText}.danger{background:ButtonFace;color:ButtonText}}
  </style><button id="remove" type="button" aria-describedby="status">Remove download</button><button id="native-check" type="button">Check native control</button><button id="details" type="button" aria-label="Show privacy-safe removal diagnostics">Details</button><span id="status" class="status" role="status" aria-live="polite"></span>`;
  const button = shadow.getElementById("remove");
  const status = shadow.getElementById("status");

  function visible(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  }
  function downloadPanels() {
    const titles = settings.panelTitles.map(normalize);
    return [...document.querySelectorAll(PANEL_SELECTOR)].filter(panel => {
      if (!visible(panel)) return false;
      // A row's video title must never be mistaken for the Downloads heading.
      const headings = [...panel.querySelectorAll(HEADER_SELECTOR)].filter(node => !node.closest(ROW_SELECTOR));
      const header = panel.querySelector("#header, #header-container");
      const labels = headings.flatMap(node => [node.textContent, node.getAttribute("title"), node.getAttribute("aria-label")]);
      if (header) labels.push(header.getAttribute("aria-label"));
      return labels.some(text => text && titles.includes(normalize(text)));
    });
  }
  function rowLink(row, id = null) {
    return [...row.querySelectorAll("a[href]")].find(a => {
      const value = videoId(a.href);
      return value && (!id || value === id);
    });
  }
  function inspection() {
    const id = videoId(location.href);
    if (!id) return {reason: "Not a supported watch page", found: null};
    if (nativeState.status === "ready") {
      const rows = [...document.querySelectorAll(ROW_SELECTOR)].filter(row => visible(row) && rowLink(row, id));
      if (rows.length > 1) return {reason: "Multiple playback rows match the current video", found: null};
      return {reason: "Experimental native download control is ready", found: {id, native: true, row: rows[0] || null, panel: rows[0]?.closest(PANEL_SELECTOR) || null}};
    }
    const panels = downloadPanels();
    if (!panels.length) return {reason: "Downloads sidebar title/layout not recognized", found: null};
    const rows = panels.flatMap(panel => [...panel.querySelectorAll(ROW_SELECTOR)]).filter(row => visible(row) && rowLink(row, id));
    if (!rows.length) return {reason: "Current video not found in the Downloads sidebar", found: null};
    if (rows.length !== 1) return {reason: "Multiple Downloads rows match the current video", found: null};
    const candidates = [];
    const row = rows[0];
    for (const node of row.querySelectorAll(MENU_BUTTON_SELECTOR)) {
      if (node.disabled || node.getAttribute("aria-disabled") === "true") continue;
      // Prefer the inner native button; do not count its wrapper twice.
      if (node.matches("yt-icon-button") && node.querySelector("button")) continue;
      candidates.push(node);
    }
    if (candidates.length !== 1) return {reason: candidates.length ? "Multiple native menu controls found" : "YouTube exposes no native menu on this Downloads row", found: null};
    return {reason: "Supported native Downloads row/menu found", found: {id, row, panel: row.closest(PANEL_SELECTOR), menuButton: candidates[0]}};
  }
  function target() {return inspection().found;}
  function nextVideo(found) {
    if (!found.panel || !found.row) return null;
    const rows = [...found.panel.querySelectorAll(ROW_SELECTOR)];
    const index = rows.indexOf(found.row);
    for (const row of rows.slice(index + 1)) {
      const link = rowLink(row);
      if (link && videoId(link.href) !== found.id) return {id: videoId(link.href), href: link.href};
    }
    return null;
  }
  function diagnosticReport() {
    const id = videoId(location.href);
    const panels = [...document.querySelectorAll(PANEL_SELECTOR)];
    const rows = panels.flatMap(panel => [...panel.querySelectorAll(ROW_SELECTOR)]);
    const currentRows = rows.filter(row => rowLink(row, id));
    const menuTags = currentRows.flatMap(row => [...row.querySelectorAll("button, yt-icon-button, ytd-menu-renderer")]).map(node => node.localName);
    return {extensionVersion: extensionApi?.runtime?.getManifest?.().version || "development",
      reason: inspection().reason, watchPage: Boolean(id), panelCount: panels.length,
      visiblePanelCount: panels.filter(visible).length, recognizedDownloadsPanelCount: downloadPanels().length,
      rowCount: rows.length, matchingCurrentRowCount: currentRows.length,
      matchingRowMenuElementTags: [...new Set(menuTags)], language: /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(document.documentElement.lang) ? document.documentElement.lang : "unknown",
      nextAfterRemoval: settings.advanceAfterRemoval,
      nativeControlStatus: nativeState.status,
      nativeControlReason: nativeState.reason,
      nativeControlStructure: safeStructure(nativeState.structure),
      nativeBridge: {
        ...bridgeState,
        adapterVersion: document.documentElement.getAttribute("data-yto-native-version") === "0.1.5" ? "0.1.5" : "missing-or-other-version",
        adapterStage: ["ready", "request-received", "request-rejected", "probe-running", "remove-running", "response-sent", "reply-failed"].find(value => value === document.documentElement.getAttribute("data-yto-native-stage")) || "missing-or-unknown"
      }};
  }
  function safeStructure(value) {
    if (!value || typeof value !== "object") return null;
    const result = {};
    for (const key of ["bindingMatches", "connected", "formattedTextPresent", "removalLabelSeen", "downloadLabelSeen", "eligibleNativeClickTarget", "openShadowRoot", "shadowRemovalLabelSeen", "shadowDownloadLabelSeen"]) result[key] = typeof value[key] === "boolean" ? value[key] : null;
    for (const key of ["directChildCount", "descendantCount", "formattedLabelCount", "nativeClickTargetCount", "shadowFormattedLabelCount"]) result[key] = Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 100000 ? value[key] : null;
    return result;
  }
  function showDetails() {
    if (modal || busy) return;
    const overlay = document.createElement("div");
    overlay.className = "backdrop";
    overlay.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="details-title"><h2 id="details-title">Removal details</h2><p>Copy this report into the support chat. It contains counts and element types, not video IDs, titles, URLs, cookies, or account information.</p><pre tabindex="0"></pre><button id="close-details" type="button">Close</button></section>`;
    overlay.querySelector("pre").textContent = JSON.stringify(diagnosticReport(), null, 2);
    shadow.append(overlay);
    modal = {element: overlay, id: null, returnFocus: shadow.getElementById("details")};
    const close = overlay.querySelector("button");
    close.addEventListener("click", closeModal);
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); closeModal();}
      if (event.key === "Tab") {
        event.preventDefault();
        (shadow.activeElement === close ? overlay.querySelector("pre") : close).focus();
      }
    });
    close.focus();
  }
  function mount() {
    const destination = document.querySelector("ytd-watch-metadata #actions") ||
      document.querySelector("ytd-watch-metadata #top-row") ||
      document.querySelector("ytd-watch-flexy #above-the-fold");
    if (destination && host.parentNode !== destination) destination.append(host);
  }
  function update() {
    scheduled = false;
    if (route !== location.href) {
      route = location.href;
      notice = "";
      nativeState = {status: "unchecked", reason: "Native control must be checked for the new video."};
      closeModal();
    }
    const id = videoId(location.href);
    host.hidden = !id;
    host.style.display = id ? "inline-flex" : "none";
    if (!id) return;
    mount();
    const inspected = inspection();
    const found = inspected.found;
    button.disabled = busy || probing || !found;
    shadow.getElementById("native-check").disabled = busy || probing;
    button.textContent = busy ? "Removing…" : "Remove download";
    const help = found ? "Remove this video's offline copy using YouTube's menu." : inspected.reason + ". Select Details for diagnostics.";
    button.title = help;
    button.setAttribute("aria-label", found ? "Remove current video from YouTube Downloads" : "Remove download unavailable: " + help);
    const text = notice || (nativeState.status !== "unchecked" && nativeState.status !== "ready" ? nativeState.reason : (found ? "" : inspected.reason));
    if (status.textContent !== text) status.textContent = text;
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }
  function closeModal() {
    if (!modal) return;
    const previous = modal;
    modal = null;
    previous.element.remove();
    const focus = previous.returnFocus || button;
    if (focus.isConnected && !focus.disabled) focus.focus();
  }
  function askConfirmation(found) {
    if (modal || busy) return;
    const overlay = document.createElement("div");
    overlay.className = "backdrop";
    overlay.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-help">
      <h2 id="confirm-title">Remove this download?</h2>
      <p id="confirm-help">Remove the current video's offline copy from YouTube Downloads using YouTube's own control. This does not delete the creator's original video.</p>
      <div class="buttons"><button id="cancel" type="button">Cancel</button><button id="confirm" class="danger" type="button">Remove download</button></div>
    </section>`;
    shadow.append(overlay);
    if (found.native) overlay.querySelector("#confirm-help").textContent = "Experimental: ask YouTube's native download control to remove this local copy, without opening Downloads or another tab. No direct database deletion is used. Native UI state—not stored media bytes—is used to check the result.";
    if (settings.advanceAfterRemoval) overlay.querySelector("#confirm-help").append(" Play next only after removal and the next video's native downloaded state are verified.");
    modal = {element: overlay, id: found.id};
    const cancel = overlay.querySelector("#cancel");
    const confirm = overlay.querySelector("#confirm");
    cancel.addEventListener("click", closeModal);
    confirm.addEventListener("click", () => {
      const fresh = target();
      const expected = modal?.id;
      closeModal();
      if (!fresh || fresh.id !== expected) {
        notice = "The video or Downloads row changed. Nothing was removed.";
        update();
        return;
      }
      remove(fresh);
    });
    overlay.addEventListener("click", event => {if (event.target === overlay) closeModal();});
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); closeModal();}
      if (event.key === "Tab") {
        event.preventDefault();
        (shadow.activeElement === cancel ? confirm : cancel).focus();
      }
    });
    cancel.focus();
  }
  function waitFor(check, timeout = 3500) {
    return new Promise((resolve, reject) => {
      let observer;
      let timer;
      let interval;
      const finish = (value, error) => {
        observer?.disconnect(); clearTimeout(timer); clearInterval(interval);
        if (error) reject(error); else resolve(value);
      };
      const run = () => {
        try {const result = check(); if (result) finish(result);}
        catch (error) {finish(null, error);}
      };
      observer = new MutationObserver(run);
      observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true});
      timer = setTimeout(() => finish(null, new Error("YouTube did not expose or confirm a supported removal control.")), timeout);
      interval = setInterval(run, 100);
      run();
    });
  }
  const menuSelector = "ytd-menu-popup-renderer";
  async function removeNative(found) {
    if (busy) return;
    busy = true;
    notice = "";
    const next = settings.advanceAfterRemoval ? nextVideo(found) : null;
    update();
    try {
      const result = await nativeRequest("remove", found.id, next?.id);
      if (videoId(location.href) !== found.id) throw new Error("Player changed; no next-video navigation attempted.");
      nativeState = {status: "unchecked", reason: "Check the native control again before another removal."};
      notice = result.reason;
      if (result.status === "removed" && next && result.nextDownloaded === true) {
        const live = [...document.querySelectorAll(ROW_SELECTOR)].map(row => rowLink(row, next.id)).filter(Boolean);
        if (live.length === 1 && videoId(live[0].href) === next.id) live[0].click();
        else notice += " Next link changed; playback was not advanced.";
      } else if (result.status === "removed" && next) notice += " Next video's downloaded state was not verified; playback was not advanced.";
    } catch (error) {notice = error.message; nativeState = {status: "unchecked", reason: "Check native control again."};}
    finally {busy = false; update();}
  }
  async function remove(found) {
    if (found.native) return removeNative(found);
    if (busy) return;
    busy = true;
    notice = "";
    update();
    const expectedId = found.id;
    const next = nextVideo(found);
    try {
      if ([...document.querySelectorAll(menuSelector)].some(visible)) throw new Error("Close the open YouTube menu and try again.");
      found.menuButton.click();
      const item = await waitFor(() => {
        if (videoId(location.href) !== expectedId || !found.row.isConnected) throw new Error("The video changed. Nothing was removed.");
        const labels = settings.removeLabels.map(normalize);
        const matches = [...document.querySelectorAll(menuSelector)].filter(visible)
          .flatMap(menu => [...menu.querySelectorAll("ytd-menu-service-item-renderer, ytd-menu-service-item-download-renderer, yt-list-item-view-model")])
          .filter(node => visible(node) && labels.includes(normalize((node.querySelector("yt-formatted-string, .yt-list-item-view-model__title") || node).textContent)));
        if (matches.length > 1) throw new Error("Ambiguous removal controls. Nothing was removed.");
        return matches[0];
      });
      // Revalidate the exact row immediately before the destructive native action.
      const current = target();
      if (!current || current.id !== expectedId || current.row !== found.row) throw new Error("The Downloads row changed. Nothing was removed.");
      item.click();
      await waitFor(() => {
        const playing = videoId(location.href);
        if (playing !== expectedId && playing !== next?.id) throw new Error("Video changed after removal request; removal could not be verified.");
        const panels = downloadPanels();
        if (panels.length !== 1) return false;
        return ![...panels[0].querySelectorAll(ROW_SELECTOR)].some(row => rowLink(row, expectedId));
      }, 5000);
      notice = "Removed from Downloads.";
      if (settings.advanceAfterRemoval && next && videoId(location.href) === expectedId) {
        const panels = downloadPanels();
        const links = panels.flatMap(panel => [...panel.querySelectorAll(ROW_SELECTOR)].map(row => rowLink(row, next.id))).filter(Boolean);
        if (links.length === 1 && videoId(links[0].href) === next.id) links[0].click();
        else notice = "Removed from Downloads; next video is no longer available.";
      }
    } catch (error) {
      notice = error.message === "YouTube did not expose or confirm a supported removal control." ?
        "Removal could not be verified. Check YouTube's native menu; no retries were made." : error.message;
    } finally {
      busy = false;
      update();
    }
  }
  button.addEventListener("click", () => {const found = target(); if (found) askConfirmation(found);});
  shadow.getElementById("details").addEventListener("click", showDetails);
  shadow.getElementById("native-check").addEventListener("click", checkNative);
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {subtree: true, childList: true});
  document.addEventListener("yt-navigate-finish", () => {
    nativeState = {status: "unchecked", reason: "Check the native control again after navigation."};
    schedule();
  });
  window.addEventListener("popstate", schedule);
  let lastReason = "";
  const periodic = () => {
    const reason = inspection().reason;
    if (route !== location.href || reason !== lastReason) {lastReason = reason; schedule();}
  };
  let routeTimer = setInterval(periodic, 750);
  window.addEventListener("pagehide", () => {
    nativeState = {status: "unchecked", reason: "Check the native control again after returning to this page."};
    observer.disconnect(); clearInterval(routeTimer); closeModal();
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      observer.observe(document.documentElement, {subtree: true, childList: true});
      routeTimer = setInterval(periodic, 750);
      schedule();
    }
  });
  extensionApi?.storage?.onChanged?.addListener((changes, area) => {
    if (area === "sync" && changes.ytOfflineRemoveSettings) {
      settings = sanitizeSettings(changes.ytOfflineRemoveSettings.newValue);
      notice = "";
      schedule();
    }
  });
  storage("get", "ytOfflineRemoveSettings")
    .then(value => {settings = sanitizeSettings(value.ytOfflineRemoveSettings); schedule();})
    .catch(() => {notice = "Settings unavailable; using default English labels."; schedule();});
  update();
})();