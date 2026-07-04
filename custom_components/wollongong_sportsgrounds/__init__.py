"""The Wollongong Sportsgrounds integration.

Every config entry monitors one sportsground, but they all share a single
coordinator so the Council page is fetched once per poll no matter how many
grounds are configured. The coordinator is created with the first entry and
dropped when the last one is removed.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import SportsgroundsCoordinator

PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]

type SportsgroundsConfigEntry = ConfigEntry[SportsgroundsCoordinator]


async def async_setup_entry(
    hass: HomeAssistant, entry: SportsgroundsConfigEntry
) -> bool:
    """Set up a sportsground from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {"coordinator": None, "entries": set()})

    coordinator: SportsgroundsCoordinator | None = domain_data["coordinator"]
    if coordinator is None:
        coordinator = SportsgroundsCoordinator(hass)
        # Raises ConfigEntryNotReady on failure; the entry is retried later and
        # the coordinator stays unset so the next attempt recreates it.
        await coordinator.async_config_entry_first_refresh()
        domain_data["coordinator"] = coordinator

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
        if not domain_data["entries"]:
            domain_data["coordinator"] = None
    return unload_ok
