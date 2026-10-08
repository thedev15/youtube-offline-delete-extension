/* Shared across content scripts and the settings page. No network or private APIs. */
(() => {
  "use strict";
  const defaults = Object.freeze({
    panelTitles: ["Downloads"],
    removeLabels: ["Remove from downloads", "Delete from downloads", "Remove download", "Delete download"],
    advanceAfterRemoval: true,
  });
  function normalize(text) {
    return String(text || "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  }
  function videoId(url) {
    try {
      const parsed = new URL(url, "https://www.youtube.com");
      if (parsed.origin !== "https://www.youtube.com" || parsed.pathname !== "/watch") return null;
      const id = parsed.searchParams.get("v");
      return /^[A-Za-z0-9_-]{11}$/u.test(id || "") ? id : null;
    } catch { return null; }
  }
  function sanitizeSettings(value) {
    const result = {};
    for (const key of Object.keys(defaults)) {
      if (key === "advanceAfterRemoval") {
        result[key] = typeof value?.[key] === "boolean" ? value[key] : defaults[key];
        continue;
      }
      const input = value && value[key];
      const lines = Array.isArray(input) ? input : defaults[key];
      result[key] = [...new Set(lines.filter(v => typeof v === "string")
        .map(v => v.trim()).filter(v => v.length > 0 && v.length <= 100))].slice(0, 12);
      if (key === "removeLabels") result[key] = result[key].filter(v => !["delete", "remove"].includes(normalize(v)));
      if (!result[key].length) result[key] = [...defaults[key]];
    }
    return result;
  }
  const extensionApi = globalThis.browser || globalThis.chrome;
  function storage(method, payload) {
    if (!extensionApi?.storage?.sync) return Promise.resolve(method === "get" ? {} : undefined);
    if (globalThis.browser) return extensionApi.storage.sync[method](payload);
    return new Promise((resolve, reject) => {
      extensionApi.storage.sync[method](payload, result => {
        const error = extensionApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    });
  }
  globalThis.YTOfflineRemove = Object.freeze({defaults, normalize, videoId, sanitizeSettings, storage, extensionApi});
})();