"""Data coordinator and page parser for Wollongong Sportsgrounds.

A single shared coordinator fetches the Council sportsgrounds page and parses
every ground out of it. Each configured ground (config entry) reads its own
slice of that shared result, so N grounds still cost one HTTP request per poll.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from html import unescape
import logging
import re

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DEFAULT_SCAN_INTERVAL, DOMAIN, OPEN_STATUS, SOURCE_URL

_LOGGER = logging.getLogger(__name__)

# Every ground on the page is a "sportsgrounds__item": its name links to a
# detail page (the last path segment is a stable slug) and its status lives in
# a <span class="status">...</span>. The markup is regular, so one findall over
# the page yields every ground. Kept deliberately tolerant of extra attributes.
_ITEM_RE = re.compile(
    r'sportsgrounds__name"><a href="(?P<url>[^"]+)"[^>]*>(?P<name>[^<]+)</a>'
    r'.*?<span class="status[^"]*">(?P<status>[^<]*)</span>',
    re.DOTALL,
)

_FETCH_TIMEOUT = aiohttp.ClientTimeout(total=30)


@dataclass(frozen=True)
class Ground:
    """A single sportsground and its current status."""

    slug: str
    name: str
    status: str
    url: str

    @property
    def is_open(self) -> bool:
        """True only when the ground is fully open (not closed/partial)."""
        return self.status.strip().casefold() == OPEN_STATUS


def parse_grounds(html: str) -> dict[str, Ground]:
    """Parse the sportsgrounds page HTML into ``{slug: Ground}``."""
    grounds: dict[str, Ground] = {}
    for match in _ITEM_RE.finditer(html):
        url = unescape(match.group("url")).strip()
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        if not slug:
            continue
        grounds[slug] = Ground(
            slug=slug,
            name=unescape(match.group("name")).strip(),
            status=unescape(match.group("status")).strip(),
            url=url,
        )
    return grounds


async def async_fetch_grounds(hass: HomeAssistant) -> dict[str, Ground]:
    """Fetch the page once and return the parsed grounds.

    Raises ``UpdateFailed`` if the page can't be read or no grounds parse out
    (e.g. Council changed the markup), so both the coordinator and the config
    flow can surface a clean error.
    """
    session = async_get_clientsession(hass)
    try:
        async with session.get(SOURCE_URL, timeout=_FETCH_TIMEOUT) as resp:
            resp.raise_for_status()
            html = await resp.text()
    except (aiohttp.ClientError, asyncio.TimeoutError) as err:
        raise UpdateFailed(f"Error fetching sportsgrounds page: {err}") from err

    grounds = parse_grounds(html)
    if not grounds:
        raise UpdateFailed("No sportsgrounds found on the Council page")
    return grounds


class SportsgroundsCoordinator(DataUpdateCoordinator[dict[str, Ground]]):
    """Shared coordinator: one page fetch feeds every configured ground."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=DEFAULT_SCAN_INTERVAL,
        )

    async def _async_update_data(self) -> dict[str, Ground]:
        """Fetch and parse the sportsgrounds page."""
        return await async_fetch_grounds(self.hass)
