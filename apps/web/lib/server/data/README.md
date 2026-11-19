# Location timezone catalog

Pinned snapshot generated October 14, 2026. This catalog contains 171,228 GeoNames cities/towns and 7,918 IATA-coded airport records. Search is server-side; the full catalog is not shipped to browsers. The small generated `lib/airport-timezones.json` contains only unambiguous code-to-zone mappings for existing flight-entry suggestions.

City data: [GeoNames](https://www.geonames.org/), [cities1000 and administrative divisions](https://download.geonames.org/export/dump/readme.txt), licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). This is a modified extract retaining city identities/names/aliases, region/district names, country, population and IANA timezone. Coordinates and unrelated fields are omitted. GeoNames is attributed alongside search results. Coverage includes cities over 1,000 people and selected administrative seats; it is not every address or village. The dataset makes no completeness or accuracy guarantee. No city search is sent to GeoNames at runtime.

Airport data: [mwgg/Airports](https://github.com/mwgg/Airports/tree/a89e4e0dda9d9878337e2da190ebe1ef1d6af705), MIT, copyright 2014 mwgg. Full notice in `AIRPORTS-LICENSE.txt`. Only records with IATA codes and timezone identifiers are retained. Airport code ambiguity cannot silently select a zone. IANA identifiers are validated against runtime support; offsets are never hardcoded.

`location-timezones-manifest.json` records counts, source hashes, airport commit, snapshot date and the generated catalog hash. Update through an explicit reviewed snapshot change, not a runtime download. Fetch the GeoNames files and airport JSON named in the manifest, then run from the repository root:

```sh
python3 scripts/data/build-location-timezones.py \
  --cities /tmp/cities1000.zip \
  --regions /tmp/admin1CodesASCII.txt \
  --districts /tmp/admin2Codes.txt \
  --airports /tmp/airports.json \
  --airport-revision UPSTREAM_COMMIT_SHA \
  --date YYYY-MM-DD
```

Review the source/count/hash diff and rerun the lookup regression tests, route/browser journeys and production tracing checks. The generator is offline and does not execute source text or links. Client queries are bounded to 120 characters, debounced and cancelled on editing/unmount; results are capped at eight and never change saved state until selected and saved through the existing form. Manual IANA timezone entry remains available.
