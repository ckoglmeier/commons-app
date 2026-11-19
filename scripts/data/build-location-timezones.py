import argparse,json,zipfile,gzip,hashlib,pathlib
parser=argparse.ArgumentParser(description="Build the pinned server-only timezone catalog from downloaded public source files.")
parser.add_argument("--cities",required=True)
parser.add_argument("--regions",required=True)
parser.add_argument("--districts",required=True)
parser.add_argument("--airports",required=True)
parser.add_argument("--airport-revision",required=True)
parser.add_argument("--date",required=True)
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
admin={}
for line in pathlib.Path(args.regions).read_text().splitlines():
 p=line.split('\t'); admin[p[0]]=p[1]
districts={}
for line in pathlib.Path(args.districts).read_text().splitlines():
 p=line.split("\t"); districts[p[0]]=p[1]
cities=[]
for line in zipfile.ZipFile(args.cities).read('cities1000.txt').decode().splitlines():
 p=line.split('\t')
 if not p[17]: continue
 # geoname ID, name, ASCII name, aliases, region, country, IANA zone, population
 cities.append([p[0],p[1],p[2],p[3],admin.get(p[8]+'.'+p[10],p[10]),p[8],p[17],int(p[14] or 0),p[10],districts.get(".".join([p[8],p[10],p[11]]),"")])
airports=[]
for key,p in json.load(open(args.airports)).items():
 if p['iata'] and p['tz']:
  airports.append([key,p['name'],p['city'],p['state'],p['country'],p['tz'],p['iata']])
data=json.dumps({'cities':cities,'airports':airports},ensure_ascii=False,separators=(',',':')).encode()
out=root/'apps/web/lib/server/data/location-timezones.json.gz';out.write_bytes(gzip.compress(data,mtime=0))
manifest={'generatedOn':args.date,'cities':len(cities),'airports':len(airports),'jsonBytes':len(data),'compressedBytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'sources':[{'url':'https://download.geonames.org/export/dump/cities1000.zip','sha256':hashlib.sha256(pathlib.Path(args.cities).read_bytes()).hexdigest(),'license':'CC BY 4.0'},{'url':'https://download.geonames.org/export/dump/admin1CodesASCII.txt','sha256':hashlib.sha256(pathlib.Path(args.regions).read_bytes()).hexdigest(),'license':'CC BY 4.0'},{'url':'https://download.geonames.org/export/dump/admin2Codes.txt','sha256':hashlib.sha256(pathlib.Path(args.districts).read_bytes()).hexdigest(),'license':'CC BY 4.0'},{'url':'https://github.com/mwgg/Airports','revision':args.airport_revision,'sha256':hashlib.sha256(pathlib.Path(args.airports).read_bytes()).hexdigest(),'license':'MIT'}]}
(root/'apps/web/lib/server/data/location-timezones-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(manifest)

zones=sorted(set(airport[5] for airport in airports))
codes={}
for airport in airports:
 codes.setdefault(airport[6],set()).add(airport[5])
(root/'apps/web/lib/airport-timezones.json').write_text(json.dumps({'zones':zones,'codes':{code:zones.index(next(iter(values))) for code,values in sorted(codes.items()) if len(values)==1}},separators=(',',':'))+'\n')
