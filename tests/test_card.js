/*
 * Card tests. No Home Assistant, no browser, no dependencies: the card file is
 * evaluated in a vm context with a minimal DOM stand-in.
 *
 *   node tests/test_card.js
 *
 * The thing these guard: Home Assistant's hui-card treats an exception from a
 * card's `hass` or `setConfig` as fatal and permanently replaces the card with
 * a message-less "Configuration error" until the page is reloaded. So the
 * setters only store and queue; rendering happens afterwards, where a failure
 * is caught, shown as the card's own error, reported, and recovered from.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CARD = path.join(
  __dirname, "..", "custom_components", "wollongong_sportsgrounds", "www",
  "wollongong-sportsground-card.js"
);
const CONST = path.join(
  __dirname, "..", "custom_components", "wollongong_sportsgrounds", "const.py"
);

/* Just enough DOM: innerHTML is a string, querySelector hands back a stable
 * stub per selector, and replacing innerHTML forgets the old stubs. */
function el(localName = "div") {
  let html = "";
  let subs = {};
  const node = {
    localName,
    style: {},
    textContent: "",
    className: "",
    dataset: {},
    classList: { toggle() {} },
    querySelector(sel) { return (subs[sel] = subs[sel] || el()); },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set: (v) => { html = v; subs = {}; },
  });
  return node;
}
class FakeHTMLElement {
  attachShadow() { this.shadowRoot = el("#shadow"); return this.shadowRoot; }
}

/* Timers are captured, not run, so a queued error report can be inspected. */
const timers = [];
const consoleErrors = [];
const ctx = vm.createContext({
  console: { info() {}, warn() {}, error: (...a) => consoleErrors.push(a) },
  HTMLElement: FakeHTMLElement,
  window: {},
  Promise,
  customElements: {
    registry: new Map(),
    get(t) { return this.registry.get(t); },
    define(t, c) { this.registry.set(t, c); },
  },
  document: {
    hidden: false,
    createElement: () => el(),
    addEventListener() {},
    querySelectorAll: () => [],
  },
  navigator: { onLine: true, userAgent: "test-agent" },
  location: { pathname: "/central-control/outdoors" },
  performance: { now: () => 12000 },
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout() {},
});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(CARD, "utf8"), ctx);
const Card = ctx.customElements.get("wollongong-sportsground-card");

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label} => ${got}${ok ? "" : `  (want ${want})`}`);
};
const assert = (label, cond) => {
  if (!cond) failures++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};
const flush = () => new Promise((r) => setImmediate(r));

const good = {
  states: {
    "binary_sensor.cawley": { state: "on", attributes: { friendly_name: "Cawley Park" } },
    "sensor.cawley_status": { state: "Partially Closed", attributes: {} },
  },
  entities: {
    "binary_sensor.cawley": { device_id: "d1" },
    "sensor.cawley_status": { device_id: "d1" },
  },
};
const make = () => {
  const c = new Card();
  c.setConfig({ type: "custom:wollongong-sportsground-card", entity: "binary_sensor.cawley" });
  return c;
};
const setHass = (c, h) => { try { c.hass = h; return null; } catch (e) { return e; } };

(async () => {
  console.log("lifecycle");
  const normal = make();
  check("setting hass does not throw", setHass(normal, good), null);
  check("nor render inside the setter", normal.shadowRoot.innerHTML, "");
  await flush();
  assert("the render runs right after", normal.shadowRoot.innerHTML.includes("wsg-bar"));
  check("and resolves the sibling status sensor",
    normal._resolveSiblings().statusEid, "sensor.cawley_status");

  let renders = 0;
  const coalesce = make();
  const realRender = coalesce._render;
  coalesce._render = function () { renders++; return realRender.call(this); };
  coalesce.hass = good; coalesce.hass = good; coalesce.hass = good;
  await flush();
  check("several updates in one tick render once", renders, 1);

  const early = new Card();
  check("hass arriving before setConfig is ignored", setHass(early, good), null);
  await flush();
  check("and renders nothing", early.shadowRoot.innerHTML, "");

  let threw = null;
  try { new Card().setConfig({ entity: "sensor.nope" }); } catch (e) { threw = e; }
  assert("a genuinely invalid config still throws (HA shows it in the editor)", !!threw);

  const reconf = make();
  reconf.hass = good;
  await flush();
  reconf.setConfig({ entity: "binary_sensor.cawley", name: "Renamed" });
  assert("a config change keeps the card on screen until the re-render",
    reconf.shadowRoot.innerHTML.includes("wsg-bar"));

  console.log("reconnect");
  /* Any registry entry can briefly be null during a reconnect - not only this
   * ground's - and the sibling scan walks the whole registry. */
  const reconnect = { ...good, entities: { ...good.entities, "sensor.unrelated": null } };
  const rc = make();
  rc.hass = reconnect;
  await flush();
  check("a null registry entry still renders",
    rc.shadowRoot.innerHTML.includes("card error"), false);
  check("and the sibling is still found", rc._resolveSiblings().statusEid, "sensor.cawley_status");
  for (const [label, h] of [
    ["a missing entities map", { states: good.states }],
    ["a missing states map", { entities: good.entities }],
  ]) {
    const c = make();
    c.hass = h;
    await flush();
    check(`${label} renders without error`, /card error/i.test(c.shadowRoot.innerHTML), false);
  }

  console.log("recovery");
  const flaky = make();
  flaky.hass = good;
  await flush();
  const realUpdate = flaky._update;
  flaky._update = () => { throw new Error("transient boom"); };
  check("a throw during render does not escape the setter", setHass(flaky, good), null);
  await flush();
  assert("the card shows its own error, not HA's", /card error/i.test(flaky.shadowRoot.innerHTML));
  check("and forgets it was built", flaky._built, false);
  flaky._update = realUpdate;
  flaky.hass = good;
  await flush();
  assert("the next good update rebuilds over the error",
    !/card error/i.test(flaky.shadowRoot.innerHTML) && flaky.shadowRoot.innerHTML.includes("wsg-bar"));

  console.log("reporting");
  /* A caught render error is re-thrown on a fresh task so Home Assistant's
   * frontend logs it - once per message, however often the card re-renders. */
  timers.length = 0;
  const noisy = make();
  noisy._update = () => { throw new Error("render broke"); };
  noisy.hass = good;
  await flush();
  noisy.hass = good;
  await flush();
  check("one report is queued for a repeated failure", timers.length, 1);
  let rethrown = null;
  try { timers[0](); } catch (e) { rethrown = e; }
  check("and it re-throws the original error", rethrown && rethrown.message, "render broke");

  console.log("versions");
  const cardVer = fs.readFileSync(CARD, "utf8").match(/CARD_VERSION = "([^"]+)"/)[1];
  const constVer = fs.readFileSync(CONST, "utf8").match(/^CARD_VERSION = "([^"]+)"/m)[1];
  /* const.py's copy is the ?v= cache-buster; if it lags, browsers keep the old card. */
  check("const.py mirrors the card version", constVer, cardVer);

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall tests passed");
  process.exit(failures ? 1 : 0);
})();
