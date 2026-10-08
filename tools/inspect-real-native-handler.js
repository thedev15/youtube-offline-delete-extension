/* Read-only DevTools helper. Select the real Downloads menu item in Elements.
 * Does not click, call handlers, delete data, inspect storage or make requests.
 * Run in the page Console, where $0 and inspect() are DevTools conveniences.
 */
(() => {
  "use strict";
  const selected = typeof $0 === "undefined" ? null : $0;
  const element = selected?.closest?.("ytd-menu-service-item-download-renderer");
  if (!element?.isConnected || element.closest('[aria-hidden="true"]')) {
    console.log("Select an element inside the real, visible Downloads-menu removal item first. Do not select an extension-created control.");
    return;
  }
  const owners = [];
  for (const key of ["polymerController", "inst"]) {
    try {
      const value = element[key];
      if (value && typeof value === "object" && !owners.includes(value)) owners.push(value);
    } catch { /* No raw exception data. */ }
  }
  owners.push(element);
  const report = owners.map((owner, index) => {
    const methods = {};
    for (const name of ["onPrimaryClicked", "onSecondaryClicked", "sendOfflineAction"]) {
      try {methods[name] = typeof owner[name] === "function";} catch {methods[name] = false;}
    }
    return {ownerKind: owner === element ? "element" : "controller", index, methods};
  });
  console.log(JSON.stringify({readOnly: true, owners: report}, null, 2));
  const owner = owners.find(value => {
    try {return typeof value.onPrimaryClicked === "function";} catch {return false;}
  });
  if (owner && typeof inspect === "function") {
    // DevTools opens the implementation; the handler is NEVER invoked here.
    inspect(owner.onPrimaryClicked);
    console.log("Opened the first available primary-handler source. If it is only a wrapper, inspect the controller implementations manually. Share static function code only, not runtime values, IDs, URLs, tokens or account data.");
  }
})();