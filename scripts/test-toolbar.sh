#!/usr/bin/env bash
set -euo pipefail

# Run against an isolated local preview, never production. Requires agent-browser.
url="${1:?Usage: bash scripts/test-toolbar.sh http://localhost:PORT}"
case "$url" in http://localhost:*|http://127.0.0.1:*) ;; *) echo 'Use a local preview URL'; exit 1 ;; esac
export AGENT_BROWSER_SESSION=toolbar-test
trap 'agent-browser close >/dev/null 2>&1 || true' EXIT
agent-browser open "$url"
agent-browser wait 'textarea'
agent-browser eval '(() => {
  if (!document.querySelector(".share").disabled) throw Error("Draft sharing must be disabled");
  if (!document.querySelector("#share-panel").hidden) throw Error("Menu must start closed");
  if (document.querySelector(".save").classList.contains("dirty")) throw Error("New draft must start clean");
  if (getComputedStyle(document.querySelector(".copy")).display !== "none") throw Error("Drafts must hide Copy all");
  if (!document.querySelector("#download-link").hidden) throw Error("Drafts must hide download");
})()'
agent-browser fill textarea 'const message = "toolbar regression test";'
agent-browser eval '(() => {
  const save = document.querySelector(".save");
  if (!save.classList.contains("dirty")) throw Error("Editing must show dirty indicator");
  if (save.getAttribute("aria-label") !== "Save (unsaved changes)") throw Error("Dirty state must be accessible");
})()'
agent-browser click '.save'
agent-browser wait '.share.enabled'
agent-browser eval '(async () => {
  const save = document.querySelector(".save");
  if (save.classList.contains("dirty")) throw Error("Saving must clear dirty indicator");
  if (save.getAttribute("aria-label") !== "Save") throw Error("Saved paste must have clean accessible label");
  const key = location.pathname.slice(1).split(".", 1)[0];
  window.savedPath = location.pathname;
  app.setDirty(true);
  app.loadDocument(key);
  for (let i = 0; i < 50 && save.classList.contains("dirty"); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (save.classList.contains("dirty")) throw Error("Loading a saved paste must clear dirty indicator");
  if (save.getAttribute("aria-label") !== "Save") throw Error("Loaded paste must have clean accessible label");
})()'
agent-browser click '.share'
agent-browser eval '(async () => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const panel = document.querySelector("#share-panel");
  const share = document.querySelector(".share");
  const status = document.querySelector("#share-status");
  const input = document.querySelector("#share-url");
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  check(!panel.hidden && share.getAttribute("aria-expanded") === "true", "Menu opens");
  check(input.value === location.href && location.pathname !== "/", "Share saved URL, including extension");
  check(document.activeElement.id === "copy-link", "Opening moves focus into panel");
  check(document.querySelector(".save").disabled, "Saved paste cannot save again");
  check(!document.querySelector(".save").classList.contains("dirty"), "Saving clears dirty indicator");
  let copied;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async url => { copied = url; } } });
  document.querySelector("#copy-link").click();
  await tick();
  check(copied === location.href && status.textContent === "Link copied!", "Clipboard receives exact URL");
  const inputStyle = getComputedStyle(input);
  const textLeft = input.getBoundingClientRect().left + parseFloat(inputStyle.borderLeftWidth) + parseFloat(inputStyle.paddingLeft);
  check(Math.abs(status.getBoundingClientRect().left - textLeft) < 1, "Copy status aligns with URL text");
  check(getComputedStyle(document.querySelector("#copy-link")).borderTopRightRadius === "0px", "Middle segment has square corners");
  check(getComputedStyle(document.querySelector("#show-qr .icon")).maskImage.includes("qr-code.svg"), "QR icon mask loaded");
  navigator.clipboard.writeText = async () => { throw Error("Denied"); };
  document.querySelector("#copy-link").click();
  await tick();
  check(status.textContent === "Select and copy the link above.", "Clipboard rejection has manual fallback");
  check(input.selectionEnd - input.selectionStart === input.value.length, "Fallback selects entire URL");
  check(panel.querySelectorAll("button").length === 2 && !document.querySelector("#native-share"), "Only copy and QR actions");
  const qrButton = document.querySelector("#show-qr");
  const qr = document.querySelector("#share-qr");
  check(qr.hidden, "QR starts collapsed");
  qrButton.click();
  check(!qr.hidden && qr.querySelector("svg") && qrButton.getAttribute("aria-expanded") === "true", "QR expands below link");
  qrButton.click();
  check(qr.hidden && qrButton.getAttribute("aria-expanded") === "false", "QR toggles closed");
  qrButton.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 27, bubbles: true }));
  check(panel.hidden && document.activeElement === share, "Escape dismisses and restores focus");
  document.body.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 83, ctrlKey: true, shiftKey: true, bubbles: true }));
  check(!panel.hidden, "Share keyboard shortcut opens menu");
  check(qr.hidden && !qr.querySelector("svg"), "Reopening clears previous QR");
  document.body.click();
  check(panel.hidden && share.getAttribute("aria-expanded") === "false", "Outside click dismisses");
  app.toggleShare(); document.querySelector(".duplicate").click();
  check(panel.hidden && share.disabled, "Duplicating dismisses menu and disables draft sharing");
  check(document.querySelector("textarea").value === "const message = \"toolbar regression test\";", "Duplicate preserves contents");
  return "PASS: toolbar states, exact URL, clipboard success/failure, QR toggle/reset, keyboard and dismissal";
})()'
agent-browser eval '(async () => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  history.pushState(null, "", window.savedPath);
  app.loadDocument(window.savedPath.slice(1));
  for (let i = 0; i < 50 && !document.querySelector(".copy.enabled"); i++) await new Promise(r => setTimeout(r, 10));
  const copy = document.querySelector(".copy");
  check(copy.classList.contains("enabled") && getComputedStyle(copy).display !== "none", "Saved paste shows Copy all");
  check(getComputedStyle(document.querySelector(".save")).display === "none", "Saved paste hides Save");
  let copied;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { copied = text; } } });
  copy.click();
  await tick(); await tick();
  check(copied === app.doc.data, "Copy all copies the exact paste");
  check(copy.textContent === "Copied!", "Copy all confirms");
  const more = document.querySelector(".more");
  const panel = document.querySelector("#more-panel");
  check(panel.hidden, "More menu starts closed");
  more.click();
  check(!panel.hidden && more.getAttribute("aria-expanded") === "true", "More menu opens");
  check(!document.querySelector("#download-link").hidden, "Saved paste offers download");
  check(document.querySelector("#download-link").download === location.pathname.slice(1).replace(/^([^.]*)$/, "$1.txt"), "Download keeps extension");
  check(document.querySelector("#raw-link").getAttribute("href") === "/raw/" + app.doc.key, "Raw link points at paste");
  const size = () => getComputedStyle(document.querySelector("#box")).fontSize;
  const before = size();
  document.querySelector("#text-larger").click();
  check(size() !== before && document.querySelector("#text-size").textContent === "115%", "Text size grows");
  document.querySelector("#text-smaller").click();
  check(size() === before, "Text size shrinks back");
  const wrap = document.querySelector("#wrap-toggle");
  wrap.click();
  check(document.body.classList.contains("key-overlay") && !wrap.checked, "Wrap switch turns off");
  wrap.click();
  check(!document.body.classList.contains("key-overlay"), "Wrap switch turns on");
  document.querySelector(".share").click();
  check(panel.hidden, "Opening share closes more menu");
  more.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 27, bubbles: true }));
  check(panel.hidden && document.activeElement === more, "Escape closes more menu");
  return "PASS: copy all, more menu, text size, wrap switch, download";
})()'
