"""Sensors: the ground's status text and Council's last-changed time."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
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
    """Set up the status text and last-changed sensors for a ground."""
    coordinator = entry.runtime_data
    async_add_entities(
        [
            SportsgroundStatusSensor(coordinator, entry),
            SportsgroundLastChangedSensor(coordinator, entry),
        ]
    )


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


class SportsgroundLastChangedSensor(SportsgroundEntity, SensorEntity):
    """When Council last changed/inspected the ground's status.

    This is Council's own timestamp from the ground's detail page, not when this
    integration polled. If the date isn't today, Council's note explains there
    has simply been no status change since their last daily inspection.
    """

    _attr_name = "Status last changed"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, coordinator, entry) -> None:
        """Initialise the last-changed sensor."""
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{self._slug}_last_changed"

    @property
    def native_value(self) -> datetime | None:
        """The Council 'status last changed' time (timezone-aware)."""
        ground = self.ground
        return ground.last_changed if ground else None

    @property
    def extra_state_attributes(self) -> dict[str, str] | None:
        """Expose Council's raw text and the ground's page."""
        ground = self.ground
        if ground is None:
            return None
        return {"raw": ground.last_changed_raw, "ground_url": ground.url}
