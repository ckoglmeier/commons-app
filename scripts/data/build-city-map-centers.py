"""Extract public city centers from the same pinned GeoNames timezone snapshot."""
import argparse, gzip, hashlib, json, pathlib, zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cities", required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[2]
directory = root / "apps/web/lib/server/data"
snapshot = json.loads((directory / "location-timezones-manifest.json").read_text())
source = pathlib.Path(args.cities).read_bytes()
source_hash = hashlib.sha256(source).hexdigest()
if source_hash != snapshot["sources"][0]["sha256"]:
    raise SystemExit("City source must match the existing pinned catalog snapshot.")
catalog = json.loads(gzip.decompress((directory / "location-timezones.json.gz").read_bytes()))
ids = {city[0] for city in catalog["cities"]}
centers = []
for line in zipfile.ZipFile(args.cities).read("cities1000.txt").decode().splitlines():
    fields = line.split("\t")
    if fields[0] in ids:
        centers.append([fields[0], float(fields[4]), float(fields[5])])
if len(centers) != len(ids):
    raise SystemExit("Every catalog city must have one source center.")
output = directory / "city-map-centers.json.gz"
output.write_bytes(gzip.compress(json.dumps(centers, separators=(",", ":")).encode(), mtime=0))
manifest = {"generatedOn": snapshot["generatedOn"], "cities": len(centers),
            "source": snapshot["sources"][0], "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
(directory / "city-map-centers-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Extracted {len(centers)} public city centers ({output.stat().st_size} compressed bytes).")
