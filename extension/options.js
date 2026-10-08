(() => {
  "use strict";
  const {defaults, sanitizeSettings, storage} = globalThis.YTOfflineRemove;
  const form = document.getElementById("settings");
  const status = document.getElementById("status");
  function show(value) {
    const settings = sanitizeSettings(value);
    document.getElementById("panels").value = settings.panelTitles.join("\n");
    document.getElementById("labels").value = settings.removeLabels.join("\n");
    document.getElementById("advance").checked = settings.advanceAfterRemoval;
  }
  async function save(value) {
    try {
      const settings = sanitizeSettings(value);
      await storage("set", {ytOfflineRemoveSettings: settings});
      show(settings);
      status.textContent = "Settings saved.";
    } catch {status.textContent = "Settings could not be saved. Check browser extension storage access.";}
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    const panelTitles = document.getElementById("panels").value.split("\n");
    const removeLabels = document.getElementById("labels").value.split("\n");
    if (removeLabels.some(label => ["delete", "remove"].includes(label.trim().toLowerCase()))) {
      status.textContent = "Use a Downloads-specific action label, not a generic Delete or Remove label.";
      return;
    }
    save({panelTitles, removeLabels, advanceAfterRemoval: document.getElementById("advance").checked});
  });
  document.getElementById("reset").addEventListener("click", () => save(defaults));
  show(defaults);
  storage("get", "ytOfflineRemoveSettings").then(value => show(value.ytOfflineRemoveSettings))
    .catch(() => {status.textContent = "Settings unavailable; showing English defaults.";});
})();