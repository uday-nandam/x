# Runway Radar

A live arrivals-and-departures view for any airport, built as an LG webOS TV app. Arrivals are cyan, departures amber,
each labelled with the city they're coming from / heading to, flight number and altitude. A banner announces each flight as
it gets close. Pick any airport from the remote.

Two renderers, chosen automatically (Settings -> Graphics to override):

* **3D**: a tilted night map that slowly orbits the airport, 3D airliners that bank in turns, altitude stalks and ground
  shadows, fading trails, a radar sweep, and a cinematic camera that swoops down to follow an arrival when nobody has touched
  the remote for a while. Needs a recent browser engine (webOS 6 / Chromium 79+) and WebGL2.
* **Flat**: the same overlay on a top-down map, for older TVs. The app drops to this on its own if the 3D scene runs
  below ~16 fps or WebGL fails.

No build step and no API keys.

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

**Magic Remote (pointer + scroll wheel)**

* Point at a flight to see its details card (route, progress bar, altitude, speed, vertical rate, heading, aircraft, registration)
  and its route drawn on the map: solid where it has flown, dotted where it's headed. Click to pin it: the camera then zooms out to frame the flight's whole route, and eases back to the airport when you unpin.
* Scroll the wheel to step through every visible flight, arrivals first.
* Click empty space to unpin. A gear button appears in the corner while the pointer is active.

**Zoom**: on-screen `+` / `−` buttons (shown while the pointer is active), the red / green remote buttons (or `-` / `+` on a keyboard), in steps of 5-100 nm. 5 nm is close enough to see the runways. The zoom you start at is *Default zoom* in settings, or press *Save zoom* to make whatever you're looking at the default.

**Standard remote**: Left/Right (or Up/Down) steps through flights, OK or yellow/blue opens settings, Back unpins.

**Settings**: airport, range (15-100 nm), graphics (Auto / 3D / Flat), camera (Orbit / Fixed). The airport picker works with the
pointer, the arrows + OK, or a USB/Bluetooth keyboard, and searches IATA/ICAO code, city or name across about 4,000 airports.
Choices are remembered. Defaults live in `app/config.js`; URL flags work when you open the app in a desktop browser
(`npm run serve`): `?airport=PHL&radius=30&mode=fancy|lite&orbit=0&cine=1` (`cine=1` shortens the idle time before the follow-cam).

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
* **Map**: 3D mode uses MapLibre GL with OpenFreeMap vector tiles and a custom night style, with the aircraft drawn by
  Three.js as a custom layer. Flat mode uses Leaflet with Esri's key-free dark-gray tiles. Both feed one shared canvas overlay.
* **Airports**: `app/js/airports.js` is generated from [OurAirports](https://ourairports.com/data/) by
  `tools/build-airports.py`.

Previewing in a browser: `npm start` serves the app and proxies the feeds (they send no CORS headers). That's also what the
Railway preview runs.

The packaged app makes cross-origin requests from `file://`. The feeds don't send CORS headers, which webOS
allows for packaged apps; if your TV's browser engine refuses, set `proxy` in `app/config.js` to a CORS proxy prefix.

Flight data is community-sourced and best-effort, so don't use it for anything safety-related.
