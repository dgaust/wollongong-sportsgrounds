"""Sensor: the ground's status text exactly as Council publishes it."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import SportsgroundsConfigEntry
from .entity import SportsgroundEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SportsgroundsConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the status text sensor for a ground."""
    async_add_entities([SportsgroundStatusSensor(entry.runtime_data, entry)])


class SportsgroundStatusSensor(SportsgroundEntity, SensorEntity):
    """The verbatim status, e.g. Open / Closed / Partially Closed."""

    _attr_name = "Status"
    _attr_icon = "mdi:soccer-field"

    def __init__(self, coordinator, entry) -> None:
        """Initialise the status sensor."""
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{self._slug}_status"

    @property
    def native_value(self) -> str | None:
        """The current status text."""
        ground = self.ground
        return ground.status if ground else None

    @property
    def extra_state_attributes(self) -> dict[str, str] | None:
        """Expose the ground's page."""
        ground = self.ground
        return {"ground_url": ground.url} if ground else None
