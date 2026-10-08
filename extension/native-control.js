/* MAIN-world adapter: delegate to YouTube's own control, never guessed API calls. */
(() => {
  "use strict";
  if (window.top !== window) return;
  const CHANNEL = "yt-offline-native-control-v1";
  const REQUEST_EVENT = "yt-offline-native-request-v2";
  const RESPONSE_EVENT = "yt-offline-native-response-v2";
  const stage = value => document.documentElement.setAttribute("data-yto-native-stage", value);
  const TAG = "ytd-menu-service-item-download-renderer";
  const REMOVE = new Set(["remove from downloads", "delete from downloads", "remove download", "delete download"]);
  const ADD = new Set(["download", "download video"]);
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  let prepared = null;
  let removing = false;
  let consent = null;
  const currentId = () => {
    const url = new URL(location.href);
    const id = url.searchParams.get("v");
    return url.origin === "https://www.youtube.com" && url.pathname === "/watch" && /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : null;
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function clear() {prepared?.container.remove(); prepared = null; consent = null;}
  document.addEventListener("click", event => {
    if (!event.isTrusted || !prepared || prepared.id !== currentId()) return;
    const host = document.getElementById("yt-offline-remove-host");
    const button = event.composedPath().find(node => node instanceof Element && node.id === "confirm");
    if (!host?.shadowRoot || button?.getRootNode() !== host.shadowRoot || !button.closest("[role=dialog]")) return;
    consent = {id: currentId(), expires: Date.now() + 2000};
  }, true);
  function labels(control) {
    return [...control.querySelectorAll("yt-formatted-string")].map(node => normalize(node.textContent));
  }
  const TARGET_SELECTOR = "tp-yt-paper-item, button, [role=menuitem]";
  function targets(control) {
    const nodes = [...control.querySelectorAll(TARGET_SELECTOR)];
    return nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)));
  }
  function ownsRemovalLabel(node) {
    const owned = [...node.querySelectorAll("yt-formatted-string")]
      .filter(label => label.closest(TARGET_SELECTOR) === node)
      .map(label => normalize(label.textContent));
    return owned.some(value => REMOVE.has(value)) && !owned.some(value => ADD.has(value));
  }
  function eligible(node, control) {
    if (!node.isConnected || !control.contains(node)) return false;
    // Ignore the adapter's intentionally offscreen/aria-hidden container, but
    // honor native target and control state, including native hidden wrappers.
    for (let part = node; part && part !== control.parentElement; part = part.parentElement) {
      if (part.disabled || part.hasAttribute("disabled") || part.hidden ||
          part.getAttribute("aria-disabled") === "true" || part.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(part);
      if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0") return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }
  function removalTargets(control) {
    const matching = targets(control).filter(ownsRemovalLabel);
    return {matching, eligible: matching.filter(node => eligible(node, control))};
  }
  function clickable(control) {
    const candidates = removalTargets(control).eligible;
    return candidates.length === 1 ? candidates[0] : null;
  }
  function snapshot(control, id) {
    if (!control) return null;
    const text = labels(control);
    const outer = targets(control);
    const removal = removalTargets(control);
    const shadowLabels = control.shadowRoot ? [...control.shadowRoot.querySelectorAll("yt-formatted-string")].map(node => normalize(node.textContent)) : [];
    let bindingMatches = null;
    try {bindingMatches = sameId(control, id);} catch { /* Record access failure without exception text. */ }
    return {
      bindingMatches,
      connected: control.isConnected,
      directChildCount: control.children.length,
      descendantCount: control.querySelectorAll("*").length,
      formattedLabelCount: text.length,
      formattedTextPresent: text.some(Boolean),
      removalLabelSeen: text.some(value => REMOVE.has(value)),
      downloadLabelSeen: text.some(value => ADD.has(value)),
      nativeClickTargetCount: outer.length,
      removalLabeledTargetCount: removal.matching.length,
      eligibleRemovalTargetCount: removal.eligible.length,
      eligibleNativeClickTarget: Boolean(clickable(control)),
      openShadowRoot: Boolean(control.shadowRoot),
      shadowFormattedLabelCount: shadowLabels.length,
      shadowRemovalLabelSeen: shadowLabels.some(value => REMOVE.has(value)),
      shadowDownloadLabelSeen: shadowLabels.some(value => ADD.has(value))
    };
  }
  const sameId = (control, id) => control.data?.serviceEndpoint?.offlineVideoEndpoint?.videoId === id;
  const offersRemove = control => {
    const text = labels(control);
    return text.some(value => REMOVE.has(value)) && !text.some(value => ADD.has(value));
  };
  const offersAdd = control => {
    const text = labels(control);
    return text.some(value => ADD.has(value)) && !text.some(value => REMOVE.has(value));
  };
  function construct(id) {
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;opacity:0;pointer-events:none;";
    const control = document.createElement(TAG);
    container.append(control);
    (document.querySelector("ytd-app") || document.body).append(container);
    // Exactly the field observed on the real native menu. No action, params or label invented.
    try {control.data = {serviceEndpoint: {offlineVideoEndpoint: {videoId: id}}};}
    catch (error) {container.remove(); throw error;}
    return {id, container, control};
  }
  async function prepare(id) {
    clear();
    for (let n = 0; n < 16 && !customElements.get(TAG); n++) {
      if (currentId() !== id) throw new Error("The player changed during the native-control check.");
      await sleep(250);
    }
    if (!customElements.get(TAG)) return {status: "unsupported", reason: "YouTube's download control is not registered in this player."};
    prepared = construct(id);
    for (let n = 0; n < 24; n++) {
      if (currentId() !== id) {clear(); throw new Error("The player changed during the native-control check.");}
      if (sameId(prepared.control, id) && offersRemove(prepared.control) && clickable(prepared.control)) {
        return {status: "ready", reason: "Native control generated a download-removal action.", structure: snapshot(prepared.control, id)};
      }
      if (sameId(prepared.control, id) && offersAdd(prepared.control)) {
        const structure = snapshot(prepared.control, id);
        clear();
        return {status: "not-downloaded", reason: "Native control offers Download, not removal. No action was executed.", structure};
      }
      await sleep(250);
    }
    const structure = snapshot(prepared.control, id);
    clear();
    return {status: "unsupported", reason: "Native control preparation did not pass the binding, label and click-target checks. No native action was executed.", structure};
  }
  async function nextDownloaded(id, current) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || "") || id === current) return false;
    const next = construct(id);
    try {
      for (let n = 0; n < 12; n++) {
        if (currentId() !== current) return false;
        if (!sameId(next.control, id)) return false;
        if (offersAdd(next.control)) return false;
        if (offersRemove(next.control) && clickable(next.control)) {
          await sleep(250);
          return currentId() === current && sameId(next.control, id) && offersRemove(next.control);
        }
        await sleep(250);
      }
      return false;
    } finally {next.container.remove();}
  }
  async function remove(id, nextId) {
    if (!prepared || prepared.id !== id || currentId() !== id) throw new Error("The prepared native control or player changed. No action was executed.");
    const original = prepared;
    const target = clickable(original.control);
    if (!original.container.isConnected || !sameId(original.control, id) || !target || !offersRemove(original.control)) {
      throw new Error("Native control no longer offers removal. No action was executed.");
    }
    // Delegate to the native DOM event handler; never invoke unknown proxy methods.
    target.click();
    let confirm = null;
    const deadline = Date.now() + 8000;
    try {
      while (Date.now() < deadline) {
        if (currentId() !== id) throw new Error("Player changed; native removal could not be verified.");
        if (sameId(original.control, id) && offersAdd(original.control)) {
          if (!confirm) confirm = construct(id);
          if (sameId(confirm.control, id) && offersAdd(confirm.control)) {
            await sleep(500);
            if (currentId() === id && sameId(original.control, id) && sameId(confirm.control, id) && offersAdd(original.control) && offersAdd(confirm.control)) {
              // Both controls can reflect optimistic/shared UI state while the
              // offline copy survives. Never promote this to durable success.
              return {status: "unverified", reason: "Native UI changed, but persistent deletion has not been verified. The saved copy may still exist. No retry or automatic advance."};
            }
          }
        }
        await sleep(250);
      }
      return {status: "unverified", reason: "Native removal was requested once, but the native UI state change could not be verified. No retry or next-video navigation."};
    } finally {confirm?.container.remove(); clear();}
  }
  async function handleRequest(request, send) {
    if (request?.channel !== CHANNEL || request.direction !== "request") return;
    if (typeof request.nonce !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(request.nonce)) {stage("request-rejected"); return;}
    stage("request-received");
    const packet = (direction, result) => ({channel: CHANNEL, direction, nonce: request.nonce, videoId: request.videoId, ...result});
    const reply = result => {
      try {send(packet("response", result)); stage("response-sent");}
      catch {stage("reply-failed");}
    };
    try {send(packet("acknowledgement", {}));}
    catch {stage("reply-failed"); return;}
    if (request.videoId !== currentId() || !["probe", "remove"].includes(request.operation)) {
      reply({status: "failed", reason: "Native request did not match the current player or supported operation. No native action was executed."});
      return;
    }
    if (removing) {reply({status: "busy", reason: "A native removal request is already active."}); return;}
    if (request.operation === "remove") {
      const allowed = consent?.id === request.videoId && consent.expires >= Date.now();
      consent = null;
      if (!allowed) {reply({status: "failed", reason: "No fresh user confirmation was observed. No native action was executed."}); return;}
    }
    removing = true;
    stage(request.operation === "probe" ? "probe-running" : "remove-running");
    try {reply(await (request.operation === "probe" ? prepare(request.videoId) : remove(request.videoId, request.nextVideoId)));}
    catch {
      let structure = null;
      try {structure = snapshot(prepared?.control, request.videoId);} catch { /* No raw errors/values in diagnostics. */ }
      clear(); reply({status: "failed", reason: "Native control preparation or verification failed. No automatic retry or navigation.", structure});
    }
    finally {removing = false;}
  }
  document.addEventListener(REQUEST_EVENT, event => {
    if (event.target !== document || typeof event.detail !== "string" || event.detail.length > 4096) return;
    let request;
    try {request = JSON.parse(event.detail);} catch {stage("request-rejected"); return;}
    handleRequest(request, packet => document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {detail: JSON.stringify(packet)})));
  }, true);
  // Retain the old diagnostic transport, but never fall back/retry a removal.
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    handleRequest(event.data, packet => window.postMessage(packet, location.origin));
  });
  window.addEventListener("pagehide", clear);
  document.addEventListener("yt-navigate-finish", clear);
  document.documentElement.setAttribute("data-yto-native-version", "0.1.7");
  stage("ready");
})();