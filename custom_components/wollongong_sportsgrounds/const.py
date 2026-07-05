"""Constants for the Wollongong Sportsgrounds integration."""

from __future__ import annotations

from datetime import timedelta

DOMAIN = "wollongong_sportsgrounds"

# The public page that lists every Council-controlled sportsground and whether
# it is open. It is server-rendered, so no browser/JS is needed to read it.
SOURCE_URL = "https://wollongong.nsw.gov.au/places/sport-and-fitness/sportsgrounds"

# Config-entry data keys. One entry == one ground.
CONF_GROUND = "ground"            # stable slug, e.g. "barina-park"
CONF_GROUND_NAME = "ground_name"  # display name captured at config time
CONF_GROUND_URL = "ground_url"    # the ground's detail page

# A single fetch of the page serves every configured ground, so we can poll
# often without hammering Council's server.
DEFAULT_SCAN_INTERVAL = timedelta(minutes=15)

MANUFACTURER = "Wollongong City Council"

# Bumped on every change to the Lovelace card; used as a cache-busting query
# on the served card URL so upgrades don't need a manual hard-refresh.
CARD_VERSION = "1.3.0"

# The binary sensor reports "open" only when the status text is exactly this.
# Anything else — Closed, Partially Closed, Closed at request of club — counts
# as not open. The raw wording is preserved by the status text sensor.
OPEN_STATUS = "open"
