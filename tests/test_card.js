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

/* Timers are captured, not run, so the guard's periodic check can be fired
 * by hand. */
const timers = [];
const intervals = [];
const app = { hass: null };
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
    querySelector: (sel) => (sel === "home-assistant" ? app : null),
    querySelectorAll: () => [],
  },
  navigator: { onLine: true, userAgent: "test-agent" },
  location: { pathname: "/central-control/outdoors" },
  performance: { now: () => 12000 },
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout() {},
  setInterval: (fn) => { intervals.push(fn); return intervals.length; },
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
  const sent = [];
  app.hass = {
    connected: true,
    callWS: (msg) => { sent.push(msg); return Promise.resolve(); },
  };
  ctx.console.error("wollongong-sportsground-card:", new Error("something broke"));
  const report = sent.find((m) => m.service_data.message.includes("something broke"));
  assert("a card error is written to Home Assistant's log", !!report);
  check("through system_log.write", report && `${report.domain}.${report.service}`, "system_log.write");
  check("under the integration's logger", report && report.service_data.logger,
    "custom_components.wollongong_sportsgrounds.card");
  assert("with the card version and device", report && report.service_data.message.includes("test-agent"));
  ctx.console.error("custom:wollongong-sportsground-card", new Error("something broke"));
  ctx.console.error("wollongong-sportsground-card:", new Error("something broke"));
  check("the same error is reported once", sent.filter((m) => m.service_data.message.includes("Console error: wollongong-sportsground-card: Error: something broke")).length, 1);
  const before = sent.length;
  ctx.console.error("some other card", new Error("not ours"));
  check("other cards' errors are left alone", sent.length, before);
  check("console.error still logs", consoleErrors.length > 0, true);

  console.log("error-card sweep");
  /* Home Assistant's wrapper with our card swapped for its error card. */
  let loads = 0;
  const errorCard = { localName: "hui-error-card", _config: { type: "error", message: "the hidden reason" } };
  const wrapper = {
    localName: "hui-card",
    config: { type: "custom:wollongong-sportsground-card", entity: "binary_sensor.cawley" },
    preview: false,
    _element: errorCard,
    load() { loads++; },
  };
  ctx.document.querySelectorAll = () => [wrapper];
  intervals.forEach((fn) => fn());
  assert("the hidden message is reported",
    sent.some((m) => m.service_data.message.includes("the hidden reason")));
  check("and the card is rebuilt", loads, 1);
  intervals.forEach((fn) => fn());
  check("but not again straight away", loads, 1);
  wrapper.preview = true;
  wrapper._element = { ...errorCard };
  const sweepsBefore = sent.length;
  intervals.forEach((fn) => fn());
  check("cards being edited are left alone", sent.length, sweepsBefore);
  ctx.document.querySelectorAll = () => [];

  console.log("registry swap");
  /* Home Assistant's app bundle replaces window.customElements with a scoped
   * registry polyfill that only knows elements defined through it. A card
   * file that ran first must re-register there, or Lovelace reports "Custom
   * element doesn't exist" for every card it creates afterwards. */
  const nativeReg = ctx.customElements;
  const scoped = { m: new Map(), get(t) { return this.m.get(t); }, define(t, c) { this.m.set(t, c); } };
  ctx.customElements = scoped;
  check("the replacement registry starts without the card", scoped.get("wollongong-sportsground-card"), undefined);
  intervals.forEach((fn) => fn());
  check("and has it after the next check", scoped.get("wollongong-sportsground-card"), nativeReg.get("wollongong-sportsground-card"));
  ctx.customElements = nativeReg;

  console.log("versions");
  const cardVer = fs.readFileSync(CARD, "utf8").match(/CARD_VERSION = "([^"]+)"/)[1];
  const constVer = fs.readFileSync(CONST, "utf8").match(/^CARD_VERSION = "([^"]+)"/m)[1];
  /* const.py's copy is the ?v= cache-buster; if it lags, browsers keep the old card. */
  check("const.py mirrors the card version", constVer, cardVer);

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall tests passed");
  process.exit(failures ? 1 : 0);
})();
