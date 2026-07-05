# Wollongong Sportsgrounds

[![Validate](https://github.com/dgaust/wollongong-sportsgrounds/actions/workflows/validate.yml/badge.svg)](https://github.com/dgaust/wollongong-sportsgrounds/actions/workflows/validate.yml)
[![hacs](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)

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

## Lovelace card

The integration ships a small dependency-free card that shows a ground's status
over an optional background image, and renders the **whole card in greyscale
when the ground is not open**.

The card's JavaScript is served and auto-loaded by the integration (no manual
resource needed on a normal setup). It has a **visual editor** — add it from the
dashboard card picker and pick a ground — or configure it in YAML:

```yaml
type: custom:wollongong-sportsground-card
entity: binary_sensor.cawley_park      # the ground's open/closed binary sensor
image: /local/grounds/cawley.jpg       # optional background image
```

| Option | Default | Description |
|---|---|---|
| `entity` | *(required)* | The ground's **binary_sensor** (on = open). |
| `image` | *(none)* | Background image URL. Put files in `config/www/…` and reference them as `/local/…`. |
| `name` | Entity name | Heading override. |
| `show_updated` | `true` | Show Council's "status last changed" time. |
| `status_entity` | auto | The text **Status** sensor. Auto-discovered from the same device. |
| `updated_entity` | auto | The **Status last changed** sensor. Auto-discovered from the same device. |

The card auto-discovers the sibling **Status** and **Status last changed**
sensors from the same device, so normally you only set `entity` (and `image`).
With no image it falls back to your theme's card colours. The served card URL is
cache-busted per version, so upgrades are picked up without a manual
hard-refresh; you can confirm the `WOLLONGONG-SPORTSGROUND-CARD` version banner
in the browser console.

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
