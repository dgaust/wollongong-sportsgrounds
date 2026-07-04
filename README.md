# Wollongong Sportsgrounds

A Home Assistant custom integration that reports whether a Wollongong City
Council sportsground is open. It reads the public
[sportsgrounds status page](https://wollongong.nsw.gov.au/places/sport-and-fitness/sportsgrounds)
and creates entities for the ground you choose.

Add the integration once per ground you want to watch — each instance is a
separate device with its own entities.

## Entities

For each configured ground you get one device with:

- **Binary sensor** (the device's primary entity) — `on` when the ground is
  fully **Open**, `off` for anything else (Closed, Partially Closed, Closed at
  request of club, …). Uses the `opening` device class, so the UI shows
  *Open* / *Closed*. Attributes: `status` (raw text) and `ground_url`.
- **Status sensor** — the status text exactly as Council publishes it
  (`Open`, `Closed`, `Partially Closed`, …). Use this when you need the precise
  wording rather than a yes/no.
- **Status last changed sensor** — a timestamp of when *Council* last changed
  the ground's status (from the ground's "See details" page), not when this
  integration polled. Council inspects grounds daily; if this isn't today's
  date it just means the status hasn't changed since their last inspection.

> The binary sensor is deliberately strict: it's only `on` for a plain "Open".
> If you want to treat "Partially Closed" as playable, read the **Status
> sensor** text in your automation instead.

## Installation

### HACS (custom repository)

1. HACS → ⋮ → **Custom repositories**.
2. Add `https://github.com/dgaust/wollongong-sportsgrounds`, category
   **Integration**.
3. Install **Wollongong Sportsgrounds**, then restart Home Assistant.

### Manual

Copy `custom_components/wollongong_sportsgrounds` into your Home Assistant
`config/custom_components/` folder and restart.

## Configuration

Settings → Devices & Services → **Add Integration** → *Wollongong
Sportsgrounds*. Pick a ground from the dropdown (populated live from the
Council page) and submit. Repeat to add more grounds.

## How it works

- All configured grounds share **one** coordinator. Each poll (every 15
  minutes) fetches the listing page once for every ground's status, plus each
  configured ground's detail page for its "status last changed" time.
- The page is server-rendered HTML; the integration parses it directly (no
  browser, no API key). If Council changes the page markup the entities go
  unavailable rather than reporting stale data.

## Notes

This is an unofficial project and is not affiliated with or endorsed by
Wollongong City Council. Always confirm play with your club or the ground's
official channels.
