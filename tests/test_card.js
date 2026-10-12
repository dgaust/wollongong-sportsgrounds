/*
 * Card tests. No Home Assistant, no browser, no dependencies: the card file is
 * evaluated in a vm context with a minimal DOM stand-in.
 *
 *   node tests/test_card.js
 *
 * The thing these guard: Home Assistant's hui-card catches a throwing `hass`
 * setter and permanently replaces the card with a message-less error card,
 * shown as "Configuration error", until the page is reloaded. So the setter
 * must never throw - in particular not on the half-populated hass a mobile app
 * can see while it reconnects.
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

/* Just enough DOM for this light-DOM card. */
function el() {
  const node = {
    children: [],
    style: {},
    textContent: "",
    className: "",
    classList: { toggle() {} },
    _sub: {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector(sel) { return (this._sub[sel] = this._sub[sel] || el()); },
  };
  let html = "";
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set: (v) => { html = v; node.children = []; },
  });
  return node;
}
class FakeHTMLElement {
  constructor() { Object.assign(this, el()); const h = el(); this._h = h;
    Object.defineProperty(this, "innerHTML", {
      get: () => h.innerHTML,
      set: (v) => { h.innerHTML = v; this.children = []; },
    });
    this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
}

const registry = new Map();
const ctx = vm.createContext({
  console: { info() {}, warn() {}, error() {} },
  HTMLElement: FakeHTMLElement,
  window: {},
  customElements: { get: (t) => registry.get(t), define: (t, c) => registry.set(t, c) },
  document: { createElement: () => el() },
  CustomEvent: class {},
});
vm.runInContext(fs.readFileSync(CARD, "utf8"), ctx);
const Card = registry.get("wollongong-sportsground-card");

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

console.log("render");
const normal = make();
check("a normal hass renders", setHass(normal, good), null);
check("and resolves the sibling status sensor",
  normal._resolveSiblings().statusEid, "sensor.cawley_status");

console.log("reconnect");
/* Any registry entry can briefly be null during a reconnect - not only this
 * ground's - and the sibling scan walks the whole registry. */
const reconnect = { ...good, entities: { ...good.entities, "sensor.unrelated": null } };
const rc = make();
check("a null registry entry does not throw", setHass(rc, reconnect), null);
check("and the sibling is still found", rc._resolveSiblings().statusEid, "sensor.cawley_status");
check("a missing entities map does not throw",
  setHass(make(), { states: good.states }), null);
check("a missing states map does not throw",
  setHass(make(), { entities: good.entities }), null);

console.log("recovery");
const flaky = make();
setHass(flaky, good);
const realUpdate = flaky._update;
flaky._update = () => { throw new Error("transient boom"); };
check("a throw during render does not escape set hass", setHass(flaky, good), null);
assert("the card shows its own error, not HA's", /card error/i.test(flaky.innerHTML));
check("and forgets it was built", flaky._built, false);
flaky._update = realUpdate;
check("the next good update renders again", setHass(flaky, good), null);
assert("rebuilding replaces the error rather than stacking under it",
  !/card error/i.test(flaky.innerHTML) && flaky.children.length === 1);

const early = new Card();
check("hass arriving before setConfig is ignored", setHass(early, good), null);

console.log("versions");
const cardVer = fs.readFileSync(CARD, "utf8").match(/CARD_VERSION = "([^"]+)"/)[1];
const constVer = fs.readFileSync(CONST, "utf8").match(/^CARD_VERSION = "([^"]+)"/m)[1];
/* const.py's copy is the ?v= cache-buster; if it lags, browsers keep the old card. */
check("const.py mirrors the card version", constVer, cardVer);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall tests passed");
process.exit(failures ? 1 : 0);
