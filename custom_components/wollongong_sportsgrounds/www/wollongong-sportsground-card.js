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

const CARD_VERSION = "1.5.0";

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

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Please define 'entity' (the ground's binary_sensor).");
    }
    if (!config.entity.startsWith("binary_sensor.")) {
      throw new Error("'entity' should be the ground's binary_sensor (open/closed).");
    }
    this._config = { show_updated: true, ...config };
    this._built = false;
    this.innerHTML = "";
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._build();
    }
    this._update();
  }

  getCardSize() {
    return 3;
  }

  _build() {
    const card = document.createElement("ha-card");
    card.className = "wsg";
    card.innerHTML = `
      <style>
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
        /* Closed: desaturate only the photo, leaving the badge, bar and text. */
        ha-card.wsg.wsg-grey .wsg-bg { filter: grayscale(100%); }
        .wsg-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 2;
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
        .wsg-bar {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1;
          padding: 10px 14px;
          /* Theme card colour, slightly translucent so a hint of photo shows. */
          background: var(--ha-card-background, var(--card-background-color, #fff));
          background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color, #fff)) 88%, transparent);
        }
        .wsg-name { font-size: 1rem; font-weight: 600; color: var(--primary-text-color); }
        .wsg-updated { font-size: 0.8rem; color: var(--secondary-text-color); margin-top: 2px; }
        /* Compact: short single row over the drawn pitch, no bottom bar. */
        ha-card.wsg.wsg-compact { min-height: 48px; }
        .wsg-compact .wsg-bar {
          top: 0;
          display: flex;
          align-items: center;
          background: transparent;
          padding: 8px 12px;
        }
        .wsg-compact .wsg-updated { display: none; }
        .wsg-compact .wsg-name {
          color: #fff;
          font-weight: 600;
          padding-right: 104px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.55);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wsg-compact .wsg-badge { top: 50%; transform: translateY(-50%); }
      </style>
      <div class="wsg-bg"></div>
      <span class="wsg-badge"></span>
      <div class="wsg-bar">
        <div class="wsg-name"></div>
        <div class="wsg-updated"></div>
      </div>
    `;
    this.appendChild(card);
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
    if (!this._hass || !this._built) return;
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
   * user set them explicitly. Fully guarded so it never throws.
   */
  _resolveSiblings() {
    const cfg = this._config;
    let statusEid = cfg.status_entity || null;
    let updatedEid = cfg.updated_entity || null;
    if (statusEid && updatedEid) return { statusEid, updatedEid };

    const hass = this._hass;
    const entReg = hass && hass.entities;
    const ent = entReg ? entReg[cfg.entity] : null;
    const deviceId = ent ? ent.device_id : null;
    if (!deviceId || !entReg) return { statusEid, updatedEid };

    for (const eid in entReg) {
      if (!eid.startsWith("sensor.")) continue;
      if (entReg[eid].device_id !== deviceId) continue;
      const s = hass.states[eid];
      const dc = s && s.attributes ? s.attributes.device_class : undefined;
      if (dc === "timestamp") {
        if (!updatedEid) updatedEid = eid;
      } else if (!statusEid) {
        statusEid = eid;
      }
    }
    return { statusEid, updatedEid };
  }
}

customElements.define("wollongong-sportsground-card", WollongongSportsgroundCard);

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

customElements.define(
  "wollongong-sportsground-card-editor",
  WollongongSportsgroundCardEditor
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "wollongong-sportsground-card",
  name: "Wollongong Sportsground Card",
  description:
    "Shows a Wollongong sportsground's open/closed status over an optional background image (greyscale when closed).",
  preview: false,
});

// eslint-disable-next-line no-console
console.info(
  `%c WOLLONGONG-SPORTSGROUND-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#2e7d32;font-weight:700;border-radius:3px 0 0 3px",
  "color:#2e7d32;background:#e8f5e9;font-weight:700;border-radius:0 3px 3px 0"
);
