"""The Wollongong Sportsgrounds integration.

Every config entry monitors one sportsground, but they all share a single
coordinator so the Council page is fetched once per poll no matter how many
grounds are configured. The coordinator is created with the first entry and
dropped when the last one is removed.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import CARD_VERSION, CONF_GROUND, DOMAIN
from .coordinator import SportsgroundsCoordinator
from .frontend import async_register_card_resource, async_remove_card_resource

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]

CARD_FILENAME = "wollongong-sportsground-card.js"
WWW_URL_BASE = f"/{DOMAIN}"
CARD_PATH = f"{WWW_URL_BASE}/{CARD_FILENAME}"

type SportsgroundsConfigEntry = ConfigEntry[SportsgroundsCoordinator]


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the Lovelace card and register it as a dashboard resource.

    Best-effort: a failure only costs the auto-registration (the log says what
    to add by hand), so it never blocks setup. The whole www folder is served,
    so the card's default background image is reachable too. It's served with
    cache headers and the resource URL carries ``?v=<CARD_VERSION>``, so
    browsers keep the module until the card actually changes. See frontend.py
    for why this is a dashboard resource rather than an extra module.
    """
    domain_data = hass.data.setdefault(DOMAIN, {"coordinator": None, "entries": set()})
    try:
        if not domain_data.get("card_served"):
            await hass.http.async_register_static_paths(
                [StaticPathConfig(WWW_URL_BASE, str(Path(__file__).parent / "www"), True)]
            )
            domain_data["card_served"] = True
        await async_register_card_resource(hass, CARD_PATH, CARD_VERSION)
    except Exception:  # noqa: BLE001 - never block setup over the card
        _LOGGER.warning(
            "Could not register the Lovelace card; add %s?v=%s as a dashboard "
            "resource (JavaScript module)",
            CARD_PATH,
            CARD_VERSION,
            exc_info=True,
        )


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


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove the card's dashboard resource with the integration's last entry."""
    others = [
        e for e in hass.config_entries.async_entries(DOMAIN) if e.entry_id != entry.entry_id
    ]
    if not others:
        await async_remove_card_resource(hass, CARD_PATH)
