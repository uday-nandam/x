# Runway Radar

A live arrivals-and-departures map for any airport, built as an LG webOS TV app. Planes are drawn on a dark map;
arrivals are cyan, departures amber, with the city they're coming from / heading to, flight number and altitude.
A banner announces each flight as it gets close. Pick any airport with the remote.

No build step and no API keys. It's plain ES5/HTML so it runs on older webOS versions too.

## Install on the TV

1. On the TV, install **Developer Mode** from the LG Content Store, sign in with an LG developer account, turn
   *Dev Mode Status* on and *Key Server* on, and note the TV's IP and passphrase.
2. On your computer:

   ```sh
   npm install
   npx ares-setup-device --add tv -i "host=<TV_IP>" -i "port=9922" -i "username=prisoner"
   npx ares-novacom --device tv --getkey      # enter the passphrase shown in Developer Mode
   npm run deploy                              # package, install and launch
   ```

The app then lives in the TV's launcher as **Runway Radar**. Developer Mode sessions expire after about 50 hours
unless you extend them in the Developer Mode app.

## Using it

* **OK** (or any colour button) opens settings: change airport, change range (15–100 nm).
* In the airport picker, use the arrows + OK on the on-screen keyboard, or type on a USB/Bluetooth keyboard. Search
  by IATA code (`IAD`), ICAO code, city or name. About 4,000 airports with scheduled service are included.
* Your choice is remembered. Defaults live in `app/config.js`; `?airport=PHL&radius=30` also works when opening
  `app/index.html` in a desktop browser (`npm run serve`).

## Screensaver caveat

webOS has no API for third-party screensavers, so this is a full-screen app you launch and leave running rather than
something the TV starts by itself. To keep the TV's own screensaver from taking over, turn it off under
*Settings → General → Screen Saver* (wording varies by model). The HUD shifts a few pixels every minute to be gentler
on OLED panels.

## How it works

* **Traffic**: [adsb.lol](https://adsb.lol) `v2/point` (falls back to [adsb.fi](https://adsb.fi)), polled every 5 s.
  Positions are dead-reckoned between polls so planes glide.
* **Routes**: per-callsign schedule files from adsb.lol's standing-data repo give origin/destination. A flight is an
  *arrival* / *departure* if the selected airport is its destination / origin. With no route known, a flight that's low,
  descending (or climbing) and pointed at (or away from) the airport is classified from its motion instead.
* **Map**: Leaflet with Esri's key-free dark-gray basemap.
* **Airports**: `app/js/airports.js` is generated from [OurAirports](https://ourairports.com/data/) by
  `tools/build-airports.py`.

The packaged app makes cross-origin requests from `file://`. The feeds don't send CORS headers, which webOS
allows for packaged apps; if your TV's browser engine refuses, set `proxy` in `app/config.js` to a CORS proxy prefix.

Flight data is community-sourced and best-effort, so don't use it for anything safety-related.
