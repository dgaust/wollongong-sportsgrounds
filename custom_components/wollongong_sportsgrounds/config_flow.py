"""Config flow for Wollongong Sportsgrounds.

Each config entry monitors a single ground, so the flow just presents a
dropdown of the grounds parsed live from Council's page. Adding the integration
again lets the user monitor another ground; the ground's slug is the unique id,
so the same ground can't be added twice.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
from homeassistant.helpers.update_coordinator import UpdateFailed

from .const import CONF_GROUND, CONF_GROUND_NAME, CONF_GROUND_URL, DOMAIN
from .coordinator import Ground, async_fetch_grounds


class SportsgroundsConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Wollongong Sportsgrounds."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pick a ground to monitor."""
        errors: dict[str, str] = {}

        try:
            grounds = await async_fetch_grounds(self.hass)
        except UpdateFailed:
            grounds = {}
            errors["base"] = "cannot_connect"

        if user_input is not None and not errors:
            slug = user_input[CONF_GROUND]
            ground = grounds.get(slug)
            if ground is None:
                errors["base"] = "unknown"
            else:
                await self.async_set_unique_id(slug)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=ground.name,
                    data={
                        CONF_GROUND: slug,
                        CONF_GROUND_NAME: ground.name,
                        CONF_GROUND_URL: ground.url,
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_build_schema(grounds.values()),
            errors=errors,
        )


def _build_schema(grounds: Iterable[Ground]) -> vol.Schema:
    """Build the ground-selection schema from parsed grounds."""
    options = [
        SelectOptionDict(value=g.slug, label=g.name)
        for g in sorted(grounds, key=lambda g: g.name)
    ]
    return vol.Schema(
        {
            vol.Required(CONF_GROUND): SelectSelector(
                SelectSelectorConfig(
                    options=options,
                    mode=SelectSelectorMode.DROPDOWN,
                    sort=True,
                )
            )
        }
    )
