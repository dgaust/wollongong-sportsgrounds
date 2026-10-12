"""The Wollongong Sportsgrounds integration.

Every config entry monitors one sportsground, but they all share a single
coordinator so the Council page is fetched once per poll no matter how many
grounds are configured. The coordinator is created with the first entry and
dropped when the last one is removed.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from urllib.parse import quote

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import CARD_VERSION, CONF_GROUND, DOMAIN
from .coordinator import SportsgroundsCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]

CARD_FILENAME = "wollongong-sportsground-card.js"
WWW_URL_BASE = f"/{DOMAIN}"
CARD_URL = f"{WWW_URL_BASE}/{CARD_FILENAME}"

# Loads the card module and keeps retrying until its custom element exists.
# Home Assistant imports each extra module exactly once per page, and a failed
# module URL stays failed for the life of that page - re-importing it doesn't
# even reach the network. A phone app resuming from the background often
# reloads before its connection is back, so that one import fails and every
# card shows "Configuration error" until the app is force-closed. This loader
# runs from a data: URL (it needs no fetch of its own) and retries the card
# with a fresh ?retry= each time (1s, 2s, 3s ... capped at 15s, and at once
# when the device comes back online or the app is shown); once the element is
# defined, Lovelace's own whenDefined hook rebuilds the error cards into real
# ones. Failed attempts are noted on window (__cardLoad_<tag>) so the card,
# once it does load, can report them to Home Assistant's log.
_CARD_LOADER_JS = """\
const tag = __TAG__;
const url = new URL(__PATH__, location.origin).href;
const note = { failures: 0, since: 0, last: "" };
let timer = 0;
let busy = false;
const load = () => {
  clearTimeout(timer);
  if (busy || customElements.get(tag)) return;
  busy = true;
  const n = note.failures;
  import(n ? `${url}${url.includes("?") ? "&" : "?"}retry=${n}` : url)
    .then(() => { busy = false; })
    .catch((err) => {
      busy = false;
      if (!n) note.since = performance.now();
      note.failures += 1;
      note.last = String((err && err.message) || err);
      window[`__cardLoad_${tag}`] = note;
      console.warn(`${tag}: load failed (attempt ${note.failures}), will retry`, err);
      if (note.failures <= 40) timer = setTimeout(load, Math.min(15000, 1000 * note.failures));
    });
};
addEventListener("online", load);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
load();
"""


def _card_loader_url(path: str, tag: str) -> str:
    """Return a data: module URL that loads ``path`` until ``tag`` is defined.

    Fully percent-encoded, so it is safe to drop into the quoted
    ``import("...")`` Home Assistant writes into index.html.
    """
    code = _CARD_LOADER_JS.replace("__PATH__", json.dumps(path)).replace(
        "__TAG__", json.dumps(tag)
    )
    return "data:text/javascript," + quote(code, safe="")

type SportsgroundsConfigEntry = ConfigEntry[SportsgroundsCoordinator]


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the Lovelace card and load it as a frontend module (once)."""
    domain_data = hass.data.setdefault(DOMAIN, {"coordinator": None, "entries": set()})
    if domain_data.get("card_registered"):
        return

    www_dir = Path(__file__).parent / "www"
    try:
        # Serve the whole www folder so both the card JS and its default
        # background image are reachable under /wollongong_sportsgrounds/.
        # cache_headers=True is deliberate: the URL is version-busted with
        # ?v=CARD_VERSION below, so caching lets the browser keep the module
        # ready before Lovelace renders (an uncached re-fetch on every page load
        # can miss the render and show a "Configuration error"), while a version
        # bump still forces a re-fetch.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(WWW_URL_BASE, str(www_dir), True)]
        )
        # Cache-bust so a card upgrade is picked up without a manual hard-refresh.
        add_extra_js_url(
            hass,
            _card_loader_url(f"{CARD_URL}?v={CARD_VERSION}", "wollongong-sportsground-card"),
        )
        domain_data["card_registered"] = True
    except (RuntimeError, ValueError) as err:
        # Non-fatal: the integration still works, the card just isn't auto-served.
        _LOGGER.warning("Could not register the Lovelace card: %s", err)


async def async_setup_entry(
    hass: HomeAssistant, entry: SportsgroundsConfigEntry
) -> bool:
    """Set up a sportsground from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {"coordinator": None, "entries": set()})

    await _async_register_card(hass)

    slug = entry.data[CONF_GROUND]
    coordinator: SportsgroundsCoordinator | None = domain_data["coordinator"]
    if coordinator is None:
        coordinator = SportsgroundsCoordinator(hass)
        coordinator.register_ground(slug)
        # Raises ConfigEntryNotReady on failure; the entry is retried later and
        # the coordinator stays unset so the next attempt recreates it.
        await coordinator.async_config_entry_first_refresh()
        domain_data["coordinator"] = coordinator
    else:
        # An extra ground joins the shared coordinator; refresh so its detail
        # page (last-changed time) is fetched now rather than at the next poll.
        coordinator.register_ground(slug)
        await coordinator.async_refresh()

    domain_data["entries"].add(entry.entry_id)
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: SportsgroundsConfigEntry
) -> bool:
    """Unload a config entry and release the shared coordinator if it's the last."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok and (domain_data := hass.data.get(DOMAIN)):
        domain_data["entries"].discard(entry.entry_id)
        if coordinator := domain_data["coordinator"]:
            coordinator.unregister_ground(entry.data[CONF_GROUND])
        if not domain_data["entries"]:
            domain_data["coordinator"] = None
    return unload_ok
