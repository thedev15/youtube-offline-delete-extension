(() => {
  "use strict";
  if (document.getElementById("yt-offline-remove-host")) return;
  const {normalize, videoId, sanitizeSettings, storage, extensionApi} = globalThis.YTOfflineRemove;
  let settings = sanitizeSettings();
  let busy = false;
  let scheduled = false;
  let modal = null;
  let route = location.href;
  let notice = "";
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
    .backdrop{position:fixed;inset:0;background:#0009;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
    .dialog{background:var(--yt-spec-base-background,#fff);color:var(--yt-spec-text-primary,#111);border:1px solid #8886;border-radius:16px;padding:24px;max-width:420px;box-shadow:0 8px 40px #0007}
    h2{font-size:20px;margin:0 0 12px}p{white-space:normal;margin:10px 0 18px}.buttons{display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap}
    @media(max-width:700px){.status{max-width:160px}.dialog{padding:18px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
    @media(forced-colors:active){button{border:1px solid ButtonText}.danger{background:ButtonFace;color:ButtonText}}
  </style><button id="remove" type="button" aria-describedby="status">Remove download</button><span id="status" class="status" role="status" aria-live="polite"></span>`;
  const button = shadow.getElementById("remove");
  const status = shadow.getElementById("status");

  function visible(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  }
  function target() {
    const id = videoId(location.href);
    if (!id) return null;
    const titles = settings.panelTitles.map(normalize);
    const candidates = [];
    for (const panel of document.querySelectorAll("ytd-playlist-panel-renderer")) {
      if (!visible(panel)) continue;
      const heading = panel.querySelector("#header #title, #header-title, #playlist-title, #title");
      if (!heading || !titles.includes(normalize(heading.textContent))) continue;
      for (const row of panel.querySelectorAll("ytd-playlist-panel-video-renderer")) {
        if (!visible(row)) continue;
        const link = [...row.querySelectorAll("a[href]")].find(a => videoId(a.href) === id);
        if (!link) continue;
        const menuButton = row.querySelector("ytd-menu-renderer button, ytd-menu-renderer yt-icon-button, button[aria-haspopup='true']");
        if (menuButton && !menuButton.disabled) candidates.push({id, row, menuButton});
      }
    }
    // Never guess among duplicate rows or touch an unrelated playlist.
    return candidates.length === 1 ? candidates[0] : null;
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
      closeModal();
    }
    const id = videoId(location.href);
    host.hidden = !id;
    host.style.display = id ? "inline-flex" : "none";
    if (!id) return;
    mount();
    const found = target();
    button.disabled = busy || !found;
    button.textContent = busy ? "Removing…" : "Remove download";
    const help = found ? "Remove this video's offline copy using YouTube's menu." :
      "Needs this video's Downloads sidebar row and its menu. Translated labels can be configured in extension options.";
    button.title = help;
    button.setAttribute("aria-label", found ? "Remove current video from YouTube Downloads" : "Remove download unavailable: " + help);
    const text = notice || (found ? "" : "Downloads removal unavailable here");
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
    if (button.isConnected && !button.disabled) button.focus();
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
  async function remove(found) {
    if (busy) return;
    busy = true;
    notice = "";
    update();
    const expectedId = found.id;
    try {
      if ([...document.querySelectorAll(menuSelector)].some(visible)) throw new Error("Close the open YouTube menu and try again.");
      found.menuButton.click();
      const item = await waitFor(() => {
        if (videoId(location.href) !== expectedId || !found.row.isConnected) throw new Error("The video changed. Nothing was removed.");
        const labels = settings.removeLabels.map(normalize);
        const matches = [...document.querySelectorAll(menuSelector)].filter(visible)
          .flatMap(menu => [...menu.querySelectorAll("ytd-menu-service-item-renderer")])
          .filter(node => visible(node) && labels.includes(normalize(node.textContent)));
        if (matches.length > 1) throw new Error("Ambiguous removal controls. Nothing was removed.");
        return matches[0];
      });
      // Revalidate the exact row immediately before the destructive native action.
      const current = target();
      if (!current || current.id !== expectedId || current.row !== found.row) throw new Error("The Downloads row changed. Nothing was removed.");
      item.click();
      await waitFor(() => {
        if (videoId(location.href) !== expectedId) throw new Error("Video changed after removal request; removal could not be verified.");
        return !found.row.isConnected;
      }, 5000);
      notice = "Removed from Downloads.";
    } catch (error) {
      notice = error.message === "YouTube did not expose or confirm a supported removal control." ?
        "Removal could not be verified. Check YouTube's native menu; no retries were made." : error.message;
    } finally {
      busy = false;
      update();
    }
  }
  button.addEventListener("click", () => {const found = target(); if (found) askConfirmation(found);});
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {subtree: true, childList: true});
  document.addEventListener("yt-navigate-finish", schedule);
  window.addEventListener("popstate", schedule);
  let routeTimer = setInterval(() => {if (route !== location.href) schedule();}, 750);
  window.addEventListener("pagehide", () => {observer.disconnect(); clearInterval(routeTimer); closeModal();});
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      observer.observe(document.documentElement, {subtree: true, childList: true});
      routeTimer = setInterval(() => {if (route !== location.href) schedule();}, 750);
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