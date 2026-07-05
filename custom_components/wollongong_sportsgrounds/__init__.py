"""The Wollongong Sportsgrounds integration.

Every config entry monitors one sportsground, but they all share a single
coordinator so the Council page is fetched once per poll no matter how many
grounds are configured. The coordinator is created with the first entry and
dropped when the last one is removed.
"""

from __future__ import annotations

import logging
from pathlib import Path

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
CARD_URL = f"/{DOMAIN}/{CARD_FILENAME}"

type SportsgroundsConfigEntry = ConfigEntry[SportsgroundsCoordinator]


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the Lovelace card and load it as a frontend module (once)."""
    domain_data = hass.data.setdefault(DOMAIN, {"coordinator": None, "entries": set()})
    if domain_data.get("card_registered"):
        return

    card_path = Path(__file__).parent / "www" / CARD_FILENAME
    try:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL, str(card_path), False)]
        )
        # Cache-bust so a card upgrade is picked up without a manual hard-refresh.
        add_extra_js_url(hass, f"{CARD_URL}?v={CARD_VERSION}")
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
