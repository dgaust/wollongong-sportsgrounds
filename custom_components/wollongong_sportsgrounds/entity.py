"""Shared base entity for Wollongong Sportsgrounds.

Both the binary sensor and the status sensor are bound to one ground (by slug)
and hang off one device per config entry. Availability follows both the
coordinator and whether the ground is still present in the fetched page.
"""

from __future__ import annotations

from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_GROUND, CONF_GROUND_NAME, CONF_GROUND_URL, DOMAIN, MANUFACTURER
from .coordinator import Ground, SportsgroundsCoordinator


class SportsgroundEntity(CoordinatorEntity[SportsgroundsCoordinator]):
    """Base class for entities tied to a single sportsground."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: SportsgroundsCoordinator, entry) -> None:
        """Bind the entity to the entry's ground and build its device."""
        super().__init__(coordinator)
        self._slug: str = entry.data[CONF_GROUND]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, self._slug)},
            name=entry.data.get(CONF_GROUND_NAME, self._slug),
            manufacturer=MANUFACTURER,
            model="Sportsground",
            configuration_url=entry.data.get(CONF_GROUND_URL),
        )

    @property
    def ground(self) -> Ground | None:
        """The current ground, or None if it's absent from the latest fetch."""
        if not self.coordinator.data:
            return None
        return self.coordinator.data.get(self._slug)

    @property
    def available(self) -> bool:
        """Available only when the coordinator succeeded and the ground exists."""
        return super().available and self.ground is not None
