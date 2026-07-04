"""Data coordinator and page parser for Wollongong Sportsgrounds.

The listing page gives every ground's name, status and detail URL in one fetch.
Each ground's *detail* page additionally shows "Status last changed" — the time
Council last inspected/updated that ground — so for the grounds that are
actually configured we also fetch their detail page. Net cost per poll is one
listing request plus one request per configured ground.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from datetime import datetime
from html import unescape
import logging
import re

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import DEFAULT_SCAN_INTERVAL, DOMAIN, OPEN_STATUS, SOURCE_URL

_LOGGER = logging.getLogger(__name__)

# Council publishes times in NSW local time.
_COUNCIL_TZ_NAME = "Australia/Sydney"
_LAST_CHANGED_FORMAT = "%d %b %Y %I:%M%p"  # e.g. "03 Jul 2026 11:51am"

# Every ground on the listing page is a "sportsgrounds__item": its name links to
# a detail page (the last path segment is a stable slug) and its status lives in
# a <span class="status">...</span>. One findall over the page yields them all.
_ITEM_RE = re.compile(
    r'sportsgrounds__name"><a href="(?P<url>[^"]+)"[^>]*>(?P<name>[^<]+)</a>'
    r'.*?<span class="status[^"]*">(?P<status>[^<]*)</span>',
    re.DOTALL,
)

# On a ground's detail page: "<em>Status last changed: </em> 03 Jul 2026 11:51am".
_LAST_CHANGED_RE = re.compile(
    r"Status last changed:\s*</em>\s*"
    r"(?P<when>\d{1,2}\s+\w{3}\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))",
    re.IGNORECASE,
)

_FETCH_TIMEOUT = aiohttp.ClientTimeout(total=30)


@dataclass(frozen=True)
class Ground:
    """A single sportsground and its current status."""

    slug: str
    name: str
    status: str
    url: str
    last_changed: datetime | None = None
    last_changed_raw: str | None = None

    @property
    def is_open(self) -> bool:
        """True only when the ground is fully open (not closed/partial)."""
        return self.status.strip().casefold() == OPEN_STATUS


def parse_grounds(html: str) -> dict[str, Ground]:
    """Parse the listing-page HTML into ``{slug: Ground}``."""
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


def parse_last_changed(html: str, tz) -> tuple[datetime | None, str | None]:
    """Parse "Status last changed" from a detail page into (datetime, raw)."""
    match = _LAST_CHANGED_RE.search(html)
    if not match:
        return None, None
    raw = re.sub(r"\s+", " ", match.group("when")).strip()
    try:
        naive = datetime.strptime(raw, _LAST_CHANGED_FORMAT)
    except ValueError:
        _LOGGER.debug("Could not parse 'status last changed' value: %r", raw)
        return None, raw
    return naive.replace(tzinfo=tz), raw


async def async_fetch_grounds(hass: HomeAssistant) -> dict[str, Ground]:
    """Fetch the listing page once and return the parsed grounds.

    Raises ``UpdateFailed`` if the page can't be read or no grounds parse out
    (e.g. Council changed the markup), so both the coordinator and the config
    flow can surface a clean error.
    """
    html = await _async_get_text(hass, SOURCE_URL)
    grounds = parse_grounds(html)
    if not grounds:
        raise UpdateFailed("No sportsgrounds found on the Council page")
    return grounds


async def _async_get_text(hass: HomeAssistant, url: str) -> str:
    """GET a URL and return its text, wrapping errors as UpdateFailed."""
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, timeout=_FETCH_TIMEOUT) as resp:
            resp.raise_for_status()
            return await resp.text()
    except (aiohttp.ClientError, asyncio.TimeoutError) as err:
        raise UpdateFailed(f"Error fetching {url}: {err}") from err


class SportsgroundsCoordinator(DataUpdateCoordinator[dict[str, Ground]]):
    """Shared coordinator: one listing fetch plus a detail fetch per ground."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=DEFAULT_SCAN_INTERVAL,
        )
        # Slugs of the grounds that are actually configured; only these have
        # their detail page fetched for the "last changed" timestamp.
        self._slugs: set[str] = set()
        self._tz = None

    def register_ground(self, slug: str) -> None:
        """Start tracking a configured ground's detail page."""
        self._slugs.add(slug)

    def unregister_ground(self, slug: str) -> None:
        """Stop tracking a ground once its entry is removed."""
        self._slugs.discard(slug)

    async def _async_update_data(self) -> dict[str, Ground]:
        """Fetch the listing, then enrich configured grounds with last-changed."""
        grounds = await async_fetch_grounds(self.hass)

        slugs = [slug for slug in self._slugs if slug in grounds]
        if not slugs:
            return grounds

        if self._tz is None:
            self._tz = await dt_util.async_get_time_zone(_COUNCIL_TZ_NAME)

        results = await asyncio.gather(
            *(self._async_fetch_last_changed(grounds[slug].url) for slug in slugs),
            return_exceptions=True,
        )
        previous = self.data or {}
        for slug, result in zip(slugs, results):
            if isinstance(result, tuple):
                when, raw = result
                grounds[slug] = replace(
                    grounds[slug], last_changed=when, last_changed_raw=raw
                )
            else:
                # A transient detail-page error: keep the last known value
                # rather than blanking the timestamp for one poll.
                _LOGGER.debug("Detail fetch failed for %s: %s", slug, result)
                if prev := previous.get(slug):
                    grounds[slug] = replace(
                        grounds[slug],
                        last_changed=prev.last_changed,
                        last_changed_raw=prev.last_changed_raw,
                    )
        return grounds

    async def _async_fetch_last_changed(
        self, url: str
    ) -> tuple[datetime | None, str | None]:
        """Fetch a ground's detail page and parse its last-changed time."""
        html = await _async_get_text(self.hass, url)
        return parse_last_changed(html, self._tz)
