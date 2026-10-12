/**
 * Wollongong Sportsground Card
 *
 * A dependency-free Lovelace card (plain custom element, no build step) for the
 * Wollongong Sportsgrounds integration. It shows a ground's open/closed status
 * over an optional background image, and renders the whole card in greyscale
 * when the ground is not open.
 *
 * Minimal config:
 *   type: custom:wollongong-sportsground-card
 *   entity: binary_sensor.cawley_park       # the ground's "open" binary sensor
 *   image: /local/grounds/cawley.jpg        # optional background image
 *
 * Optional:
 *   name: "Cawley Park"                      # heading override
 *   show_updated: true                       # show Council's "last changed" time
 *   status_entity: sensor.cawley_park_status # override auto-discovery
 *   updated_entity: sensor.cawley_park_status_last_changed
 */

const CARD_VERSION = "1.7.0";

// Shipped with the integration and served from the same static route. Used as
// the background when the card has no `image` set (full layout). `image: none`
// opts out; `image: field` (and the compact layout) use the drawn pitch below.
const DEFAULT_IMAGE =
  "/wollongong_sportsgrounds/default-background.jpg?v=" + CARD_VERSION;

// A drawn soccer pitch (no photo), used by the compact layout and `image: field`.
const FIELD_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='160' preserveAspectRatio='xMidYMid slice'>" +
  "<rect width='320' height='160' fill='#3c8a3c'/>" +
  "<g fill='#409140'><rect x='0' width='53' height='160'/><rect x='107' width='53' height='160'/><rect x='213' width='53' height='160'/></g>" +
  "<g fill='none' stroke='#ffffff' stroke-width='2.4' opacity='0.85'>" +
  "<rect x='8' y='8' width='304' height='144' rx='2'/>" +
  "<line x1='160' y1='8' x2='160' y2='152'/>" +
  "<circle cx='160' cy='80' r='24'/>" +
  "<rect x='8' y='40' width='40' height='80'/><rect x='8' y='58' width='16' height='44'/>" +
  "<rect x='272' y='40' width='40' height='80'/><rect x='296' y='58' width='16' height='44'/>" +
  "</g>" +
  "<g fill='#ffffff' opacity='0.85'><circle cx='160' cy='80' r='2.2'/><circle cx='40' cy='80' r='2'/><circle cx='280' cy='80' r='2'/></g>" +
  "</svg>";
const FIELD_IMAGE = "data:image/svg+xml," + encodeURIComponent(FIELD_SVG);

/* ------------------------------------------------------------------ *
 * Failure reporting and recovery
 * ------------------------------------------------------------------ */

/*
 * Outside edit mode Home Assistant shows a broken card as a bare
 * "Configuration error" and keeps the reason to itself (the message is only
 * rendered in edit mode, and only logged to the browser console). On a phone
 * that leaves nothing to go on. So this module reports, to Home Assistant's
 * own log (Settings > System > Logs, logger "custom_components.wollongong_sportsgrounds.card"):
 *
 *   - any console error that names one of these cards - Home Assistant logs
 *     every card it gives up on there, with the exception;
 *   - any of these cards found replaced by Home Assistant's error card, with
 *     the hidden message read off that error card;
 *   - a card file that only loaded after failed attempts (the loader leaves a
 *     note on window for this module to pick up).
 *
 * A card found replaced is also rebuilt through the card wrapper's public
 * load(), a few times at most, so a one-off failure doesn't stay on screen
 * until the app is restarted. Everything here is best-effort and swallows its
 * own errors: diagnostics must never be what breaks a dashboard.
 */
const GUARD = (() => {
  const LOGGER = "custom_components.wollongong_sportsgrounds.card";
  const TAG_PREFIX = "wollongong-sportsground-card";
  const LOAD_TAG = "wollongong-sportsground-card";
  /* Loaded twice (a leftover dashboard resource as well as the auto-load)?
   * Install once, or every error would be reported twice. */
  const KEY = `__cardGuard_${TAG_PREFIX}`;
  if (window[KEY]) return window[KEY];
  const MAX_REPORTS = 25;
  const REBUILD_GAP_MS = 20000;
  const MAX_REBUILDS = 5;
  const sent = new Set();
  const queue = [];
  const rebuilds = new WeakMap();
  let flushTimer = 0;

  const appHass = () => {
    const ha = document.querySelector("home-assistant");
    return ha ? ha.hass : null;
  };

  const context = () =>
    `[card ${CARD_VERSION}; up ${Math.round(performance.now() / 1000)}s; ` +
    `online=${navigator.onLine}; visible=${!document.hidden}; ` +
    `${location.pathname}; ${navigator.userAgent}]`;

  /* Raw call_service over the socket rather than hass.callService, which
   * can raise a toast of its own when the call fails. */
  const flush = () => {
    clearTimeout(flushTimer);
    flushTimer = 0;
    try {
      const hass = appHass();
      if (!hass || !hass.connected || !hass.callWS) {
        if (queue.length) flushTimer = setTimeout(flush, 5000);
        return;
      }
      while (queue.length) {
        const [level, message] = queue.shift();
        hass
          .callWS({
            type: "call_service",
            domain: "system_log",
            service: "write",
            service_data: { logger: LOGGER, level, message },
          })
          .catch(() => {});
      }
    } catch (_err) {
      /* Reporting is best-effort. */
    }
  };

  /* `key` decides what counts as the same problem: an error's stack differs
   * by call site, so the console path keys on name + message alone. */
  const report = (level, text, key = text) => {
    if (sent.has(key) || sent.size >= MAX_REPORTS) return;
    sent.add(key);
    queue.push([level, `${text} ${context()}`]);
    flush();
  };

  /* Duck-typed: an Error from another realm fails instanceof. */
  const isError = (arg) =>
    !!arg && typeof arg === "object" && typeof arg.message === "string" && "stack" in arg;

  const describe = (arg) => {
    if (isError(arg)) {
      const stack = (arg.stack || "").split("\n").slice(0, 6).join("\n");
      return stack.includes(arg.message) ? stack : `${arg.name}: ${arg.message}\n${stack}`;
    }
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg).slice(0, 500);
    } catch (_err) {
      return String(arg);
    }
  };

  const ours = (type) => typeof type === "string" && type.startsWith(`custom:${TAG_PREFIX}`);

  /* Home Assistant logs a card it gives up on as console.error(type, err)
   * (or "card", type, err); the cards log their own failures the same way. */
  const consoleError = console.error;
  console.error = function (...args) {
    try {
      if (args.some((a) => typeof a === "string" && a.includes(TAG_PREFIX))) {
        const key = args.map((a) => (isError(a) ? `${a.name}: ${a.message}` : describe(a))).join(" ");
        report("error", `Console error: ${args.map(describe).join(" ")}`, key);
      }
    } catch (_err) {
      /* never let diagnostics break logging */
    }
    return consoleError.apply(this, args);
  };

  const huiCards = (root, out) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.localName === "hui-card") out.push(el);
      if (el.shadowRoot) huiCards(el.shadowRoot, out);
    }
    return out;
  };

  const sweep = () => {
    try {
      if (document.hidden) return;
      for (const wrapper of huiCards(document, [])) {
        const type = wrapper.config && wrapper.config.type;
        if (!ours(type) || wrapper.preview) continue;
        const el = wrapper._element || wrapper.firstElementChild;
        if (!el || el.localName !== "hui-error-card") continue;

        const message = (el._config && el._config.message) ||
          "no message (Home Assistant replaces the card this way when a property setter throws)";
        report("error", `${type} was showing Home Assistant's error card: ${message}`);

        /* Rebuild only once our element exists - otherwise the loader is
         * still working on it and Lovelace will rebuild by itself. */
        const tag = type.slice("custom:".length);
        const seen = rebuilds.get(wrapper) || { count: 0, last: 0 };
        const now = Date.now();
        if (!customElements.get(tag) || seen.count >= MAX_REBUILDS || now - seen.last < REBUILD_GAP_MS) {
          continue;
        }
        rebuilds.set(wrapper, { count: seen.count + 1, last: now });
        if (typeof wrapper.load === "function") {
          wrapper.load();
          report("warning", `${type} rebuilt after Home Assistant's error card (rebuild ${seen.count + 1})`);
        }
      }
    } catch (err) {
      report("warning", `Card check failed: ${describe(err)}`);
    }
  };

  /* The loader notes failed attempts on window before this file ran. */
  try {
    const note = window[`__cardLoad_${LOAD_TAG}`];
    if (note && note.failures) {
      report(
        "warning",
        `Card file needed ${note.failures + 1} attempts to load ` +
          `(${Math.round((performance.now() - note.since) / 1000)}s after the first failure; ` +
          `last error: ${note.last})`
      );
    }
  } catch (_err) {
    /* best-effort */
  }

  setInterval(sweep, 10000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(sweep, 2000);
  });
  setTimeout(sweep, 5000);

  window[KEY] = { report, describe };
  return window[KEY];
})();

class WollongongSportsgroundCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("wollongong-sportsground-card-editor");
  }

  static getStubConfig(hass) {
    // Default to the first Wollongong sportsground binary_sensor, if any.
    let entity = "";
    if (hass && hass.states) {
      entity =
        Object.keys(hass.states).find(
          (e) =>
            e.startsWith("binary_sensor.") &&
            hass.states[e].attributes &&
            hass.states[e].attributes.device_class === "opening"
        ) || "";
    }
    return { entity, image: "", show_updated: true };
  }

  /*
   * Lifecycle, as Home Assistant's custom card docs lay it out:
   *
   *   setConfig  validate and store the config - throw only for a config that
   *              is genuinely invalid (HA shows that message in the editor);
   *   hass       store the latest state - called on every state change;
   *   render     done separately, never inside either call.
   *
   * Rendering is queued as a microtask rather than run inside the setter. Home
   * Assistant's card wrapper treats an exception from `hass` (or `setConfig`)
   * as fatal and swaps the card for a permanent "Configuration error" until the
   * page reloads, so nothing that can fail runs there at all. The queue also
   * coalesces the setConfig + hass pair a new card receives into one render.
   */
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._queued = false;
    this._built = false;
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Please define 'entity' (the ground's binary_sensor).");
    }
    if (typeof config.entity !== "string" || !config.entity.startsWith("binary_sensor.")) {
      throw new Error("'entity' should be the ground's binary_sensor (open/closed).");
    }
    this._config = { show_updated: true, ...config };
    this._queueRender();
  }

  set hass(hass) {
    this._hass = hass;
    this._queueRender();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._queueRender();
  }

  getCardSize() {
    return 3;
  }

  _queueRender() {
    if (this._queued) return;
    this._queued = true;
    Promise.resolve().then(() => {
      this._queued = false;
      this._render();
    });
  }

  /*
   * The one place the card touches its DOM. Any failure is caught and shown
   * as the card's own error (and reported to Home Assistant's log); _built is
   * cleared so the next update rebuilds from scratch rather than patching a
   * DOM that never finished.
   */
  _render() {
    if (!this._config || !this._hass) return;
    try {
      if (!this._built) this._build();
      this._update();
    } catch (err) {
      this._renderError(err);
    }
  }

  _renderError(err) {
    this._built = false;
    this._els = null;
    const msg = (err && err.message) || String(err);
    this.shadowRoot.innerHTML = `<ha-card><div style="padding:12px 16px;color:var(--secondary-text-color)">Sportsground card error: ${msg}</div></ha-card>`;
    // eslint-disable-next-line no-console
    console.error("wollongong-sportsground-card:", err);
  }

  _build() {
    // Replaces whatever was there - an error card from a failed pass, in
    // particular - rather than stacking beneath it.
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>
        :host { display: block; }
        ha-card.wsg {
          position: relative;
          overflow: hidden;
          min-height: 140px;
          display: block;
        }
        .wsg-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
          background-size: cover;
          background-position: center;
          background-color: var(--ha-card-background, var(--card-background-color, #222));
          transition: filter 300ms ease;
        }
        /* Closed: desaturate only the background, leaving the bar and text. */
        ha-card.wsg.wsg-grey .wsg-bg { filter: grayscale(100%); }
        /* Frosted bar across the bottom: name/time on the left, status on the right. */
        .wsg-bar {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 14px;
          /* Theme card colour, slightly translucent so a hint of background shows. */
          background: var(--ha-card-background, var(--card-background-color, #fff));
          background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color, #fff)) 88%, transparent);
        }
        .wsg-text { flex: 1 1 auto; min-width: 0; }
        .wsg-name { font-size: 1rem; font-weight: 600; color: var(--primary-text-color); }
        .wsg-updated { font-size: 0.8rem; color: var(--secondary-text-color); margin-top: 2px; }
        .wsg-badge {
          flex: none;
          padding: 4px 12px;
          border-radius: 999px;
          font-weight: 700;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-primary-color, #fff);
          background: var(--disabled-color, #9e9e9e);
          white-space: nowrap;
        }
        /* Honour the theme's primary/accent colours; green/red are fallbacks. */
        .wsg-badge.wsg-open { background: var(--primary-color, #2e7d32); }
        .wsg-badge.wsg-closed { background: var(--accent-color, #c62828); }
        /* Compact: short row over a dimmed background; no last-changed line. */
        ha-card.wsg.wsg-compact { min-height: 48px; }
        .wsg-compact .wsg-bar { top: 0; background: rgba(0, 0, 0, 0.34); }
        .wsg-compact .wsg-updated { display: none; }
        .wsg-compact .wsg-name {
          color: #fff;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
      <ha-card class="wsg">
        <div class="wsg-bg"></div>
        <div class="wsg-bar">
          <div class="wsg-text">
            <div class="wsg-name"></div>
            <div class="wsg-updated"></div>
          </div>
          <span class="wsg-badge"></span>
        </div>
      </ha-card>
    `;
    const card = root.querySelector("ha-card");
    this._els = {
      card,
      bg: card.querySelector(".wsg-bg"),
      name: card.querySelector(".wsg-name"),
      badge: card.querySelector(".wsg-badge"),
      updated: card.querySelector(".wsg-updated"),
    };
    this._built = true;
  }

  _update() {
    if (!this._built || !this._hass.states) return;
    const cfg = this._config;
    const els = this._els;
    const st = this._hass.states[cfg.entity];

    const unavailable = !st || st.state === "unavailable" || st.state === "unknown";
    const open = !!st && st.state === "on";

    const { statusEid, updatedEid } = this._resolveSiblings();
    const statusState = statusEid ? this._hass.states[statusEid] : null;

    // Label: prefer the text status sensor ("Partially Closed" etc.).
    let label;
    if (unavailable) {
      label = "Unavailable";
    } else if (statusState && statusState.state && statusState.state !== "unavailable") {
      label = statusState.state;
    } else {
      label = open ? "Open" : "Closed";
    }

    const name =
      cfg.name ||
      (st && st.attributes && st.attributes.friendly_name) ||
      cfg.entity;

    els.card.classList.toggle("wsg-compact", !!cfg.compact);

    // Background: explicit image wins; `none` = theme colours; `field` = the
    // drawn pitch; otherwise the default (photo for full, pitch for compact).
    let image;
    if (cfg.image === "none") {
      image = "";
    } else if (cfg.image === "field") {
      image = FIELD_IMAGE;
    } else {
      image = cfg.image || (cfg.compact ? FIELD_IMAGE : DEFAULT_IMAGE);
    }
    els.bg.style.backgroundImage = image ? `url("${image}")` : "";

    // Greyscale (background only) whenever the ground is not open.
    els.card.classList.toggle("wsg-grey", !open);

    els.name.textContent = name;
    els.badge.textContent = label;
    els.badge.classList.toggle("wsg-open", open);
    els.badge.classList.toggle("wsg-closed", !open && !unavailable);

    // "Status last changed" — prefer Council's raw wording attribute.
    let updatedText = "";
    if (cfg.show_updated && updatedEid && this._hass.states[updatedEid]) {
      const u = this._hass.states[updatedEid];
      const raw = u.attributes && u.attributes.raw;
      if (raw) {
        updatedText = `Updated ${raw}`;
      } else if (u.state && u.state !== "unavailable" && u.state !== "unknown") {
        const d = new Date(u.state);
        if (!isNaN(d)) updatedText = `Updated ${d.toLocaleString()}`;
      }
    }
    els.updated.textContent = updatedText;
    els.updated.style.display = updatedText ? "" : "none";
  }

  /**
   * Find the sibling status/last-changed sensors on the same device, unless the
   * user set them explicitly.
   *
   * Must never throw. The loop walks the whole entity registry, and during a
   * reconnect any entry in it can briefly be null - not just this ground's -
   * so a bare `entReg[eid].device_id` broke the card whenever one did. Each
   * entry is null-guarded, and the scan is wrapped so it returns whatever it
   * found rather than failing the render.
   */
  _resolveSiblings() {
    const cfg = this._config;
    let statusEid = cfg.status_entity || null;
    let updatedEid = cfg.updated_entity || null;
    if (statusEid && updatedEid) return { statusEid, updatedEid };

    try {
      const hass = this._hass;
      const entReg = hass && hass.entities;
      const ent = entReg ? entReg[cfg.entity] : null;
      const deviceId = ent ? ent.device_id : null;
      if (!deviceId || !entReg) return { statusEid, updatedEid };

      for (const eid in entReg) {
        if (!eid.startsWith("sensor.")) continue;
        const reg = entReg[eid];
        if (!reg || reg.device_id !== deviceId) continue;
        const s = hass.states ? hass.states[eid] : null;
        const dc = s && s.attributes ? s.attributes.device_class : undefined;
        if (dc === "timestamp") {
          if (!updatedEid) updatedEid = eid;
        } else if (!statusEid) {
          statusEid = eid;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("wollongong-sportsground-card: sibling lookup failed", err);
    }
    return { statusEid, updatedEid };
  }
}

// Guard against double-registration: if this module is loaded more than once
// (e.g. as both a dashboard resource and the auto-loaded module), a second
// define() would throw and break the card. Define each element only once.
if (!customElements.get("wollongong-sportsground-card")) {
  customElements.define("wollongong-sportsground-card", WollongongSportsgroundCard);
}

/**
 * Visual editor for the card. Uses HA's built-in <ha-form> with selectors, so
 * it stays dependency-free while giving an entity picker, text fields and a
 * toggle. Falls back gracefully if <ha-form> isn't available.
 */
class WollongongSportsgroundCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _schema() {
    return [
      {
        name: "entity",
        required: true,
        selector: {
          entity: {
            domain: "binary_sensor",
            integration: "wollongong_sportsgrounds",
          },
        },
      },
      { name: "name", selector: { text: {} } },
      { name: "image", selector: { text: {} } },
      { name: "compact", selector: { boolean: {} } },
      { name: "show_updated", selector: { boolean: {} } },
    ];
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      if (!customElements.get("ha-form")) {
        // Editor unavailable in this context; users can still use YAML.
        this.innerHTML =
          '<p style="padding:8px">Visual editor unavailable here — use the code editor.</p>';
        return;
      }
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) =>
        ({
          entity: "Ground (binary sensor)",
          name: "Name (optional)",
          image: "Background (optional)",
          compact: "Compact layout",
          show_updated: "Show 'last changed' time",
        })[s.name] || s.name;
      this._form.computeHelper = (s) =>
        ({
          image:
            "Blank = default (photo, or drawn pitch when compact); 'field' = drawn pitch; 'none' = theme colours; or a URL like /local/grounds/cawley.jpg",
          compact: "Shorter card with a drawn soccer pitch background",
        })[s.name] || "";
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: ev.detail.value },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(this._form);
    }

    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = { show_updated: true, ...this._config };
  }
}

if (!customElements.get("wollongong-sportsground-card-editor")) {
  customElements.define(
    "wollongong-sportsground-card-editor",
    WollongongSportsgroundCardEditor
  );
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "wollongong-sportsground-card")) {
  window.customCards.push({
    type: "wollongong-sportsground-card",
    name: "Wollongong Sportsground Card",
    description:
      "Shows a Wollongong sportsground's open/closed status over an optional background image (greyscale when closed).",
    preview: false,
  });
}

// eslint-disable-next-line no-console
console.info(
  `%c WOLLONGONG-SPORTSGROUND-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#2e7d32;font-weight:700;border-radius:3px 0 0 3px",
  "color:#2e7d32;background:#e8f5e9;font-weight:700;border-radius:0 3px 3px 0"
);
