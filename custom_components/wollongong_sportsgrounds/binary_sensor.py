"""Binary sensor: is the sportsground open?"""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import SportsgroundsConfigEntry
from .entity import SportsgroundEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SportsgroundsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the open/closed binary sensor for a ground."""
    async_add_entities([SportsgroundOpenBinarySensor(entry.runtime_data, entry)])


class SportsgroundOpenBinarySensor(SportsgroundEntity, BinarySensorEntity):
    """On when the ground is fully open, off otherwise.

    This is the entry's primary entity (``_attr_name = None``), so its friendly
    name is just the ground name. The ``opening`` device class renders the state
    as Open / Closed to match Council's wording.
    """

    _attr_name = None
    _attr_device_class = BinarySensorDeviceClass.OPENING

    def __init__(self, coordinator, entry) -> None:
        """Initialise the binary sensor."""
        super().__init__(coordinator, entry)
        self._attr_unique_id = self._slug

    @property
    def is_on(self) -> bool | None:
        """True when the ground status is exactly 'Open'."""
        ground = self.ground
        return ground.is_open if ground else None

    @property
    def extra_state_attributes(self) -> dict[str, str] | None:
        """Expose the raw status text and the ground's page."""
        ground = self.ground
        if ground is None:
            return None
        return {"status": ground.status, "ground_url": ground.url}
