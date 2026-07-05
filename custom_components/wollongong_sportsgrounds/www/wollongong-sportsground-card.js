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

const CARD_VERSION = "1.0.0";

class WollongongSportsgroundCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "", image: "", show_updated: true };
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
          display: flex;
          transition: filter 300ms ease;
        }
        ha-card.wsg.wsg-grey { filter: grayscale(100%); }
        .wsg-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
          background-size: cover;
          background-position: center;
          background-color: var(--ha-card-background, var(--card-background-color, #222));
        }
        .wsg-overlay {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.65) 100%);
          opacity: 0;
          transition: opacity 200ms ease;
        }
        ha-card.wsg.wsg-has-image .wsg-overlay { opacity: 1; }
        .wsg-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 12px;
          padding: 16px;
          width: 100%;
          color: var(--primary-text-color);
        }
        ha-card.wsg.wsg-has-image .wsg-content { color: #fff; }
        ha-card.wsg.wsg-has-image .wsg-name,
        ha-card.wsg.wsg-has-image .wsg-updated {
          text-shadow: 0 1px 2px rgba(0,0,0,0.6);
        }
        .wsg-name { font-size: 1.15rem; font-weight: 600; }
        .wsg-bottom { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .wsg-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 999px;
          font-weight: 700;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #fff;
          background: var(--disabled-color, #757575);
          white-space: nowrap;
        }
        .wsg-badge.wsg-open { background: #2e7d32; }
        .wsg-badge.wsg-closed { background: #c62828; }
        .wsg-updated { font-size: 0.8rem; opacity: 0.85; }
      </style>
      <div class="wsg-bg"></div>
      <div class="wsg-overlay"></div>
      <div class="wsg-content">
        <div class="wsg-name"></div>
        <div class="wsg-bottom">
          <span class="wsg-badge"></span>
          <span class="wsg-updated"></span>
        </div>
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

    // Background image.
    els.card.classList.toggle("wsg-has-image", !!cfg.image);
    els.bg.style.backgroundImage = cfg.image ? `url("${cfg.image}")` : "";

    // Greyscale whenever the ground is not open (closed / partial / unavailable).
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
