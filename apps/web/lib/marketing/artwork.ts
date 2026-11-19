/** Bundled, visually reviewed artwork only. Never fetch a cover during setup. */
export type LocalArtwork = { key: string; src: string; title: string };

export const destinationArtwork: Record<string, LocalArtwork> = {
  'dublin': { key: 'destination:dublin:v1', src: '/brand/destinations/dublin.webp', title: "Dublin illustration" },
  'edinburgh': { key: 'destination:edinburgh:v1', src: '/brand/destinations/edinburgh.webp', title: "Edinburgh illustration" },
  'rome': { key: 'destination:rome:v1', src: '/brand/destinations/rome.webp', title: "Rome illustration" },
  'barcelona': { key: 'destination:barcelona:v1', src: '/brand/destinations/barcelona.webp', title: "Barcelona illustration" },
  'porto': { key: 'destination:porto:v1', src: '/brand/destinations/porto.webp', title: "Porto illustration" },
  'san-juan': { key: 'destination:san-juan:v1', src: '/brand/destinations/san-juan.webp', title: "San Juan illustration" },
  'puerto-vallarta': { key: 'destination:puerto-vallarta:v1', src: '/brand/destinations/puerto-vallarta.webp', title: "Puerto Vallarta illustration" },
  'cancun': { key: 'destination:cancun:v1', src: '/brand/destinations/cancun.webp', title: "Cancun illustration" },
  'cabo-san-lucas': { key: 'destination:cabo-san-lucas:v1', src: '/brand/destinations/cabo-san-lucas.webp', title: "Cabo San Lucas illustration" },
  'oahu': { key: 'destination:oahu:v1', src: '/brand/destinations/oahu.webp', title: "Oahu illustration" },
  'maui': { key: 'destination:maui:v1', src: '/brand/destinations/maui.webp', title: "Maui illustration" },
  'banff': { key: 'destination:banff:v1', src: '/brand/destinations/banff.webp', title: "Banff illustration" },
  'whistler': { key: 'destination:whistler:v1', src: '/brand/destinations/whistler.webp', title: "Whistler illustration" },
  'jackson-hole': { key: 'destination:jackson-hole:v1', src: '/brand/destinations/jackson-hole.webp', title: "Jackson Hole illustration" },
  'steamboat-springs': { key: 'destination:steamboat-springs:v1', src: '/brand/destinations/steamboat-springs.webp', title: "Steamboat Springs illustration" },
  'vail': { key: 'destination:vail:v1', src: '/brand/destinations/vail.webp', title: "Vail illustration" },
  'breckenridge': { key: 'destination:breckenridge:v1', src: '/brand/destinations/breckenridge.webp', title: "Breckenridge illustration" },
  'park-city': { key: 'destination:park-city:v1', src: '/brand/destinations/park-city.webp', title: "Park City illustration" },
  'lake-tahoe': { key: 'destination:lake-tahoe:v1', src: '/brand/destinations/lake-tahoe.webp', title: "Lake Tahoe illustration" },
  'gatlinburg': { key: 'destination:gatlinburg:v1', src: '/brand/destinations/gatlinburg.webp', title: "Gatlinburg illustration" },
  'cape-cod': { key: 'destination:cape-cod:v1', src: '/brand/destinations/cape-cod.webp', title: "Cape Cod illustration" },
  'gulf-shores': { key: 'destination:gulf-shores:v1', src: '/brand/destinations/gulf-shores.webp', title: "Gulf Shores illustration" },
  'destin': { key: 'destination:destin:v1', src: '/brand/destinations/destin.webp', title: "Destin illustration" },
  'myrtle-beach': { key: 'destination:myrtle-beach:v1', src: '/brand/destinations/myrtle-beach.webp', title: "Myrtle Beach illustration" },
  'hilton-head': { key: 'destination:hilton-head:v1', src: '/brand/destinations/hilton-head.webp', title: "Hilton Head illustration" },
  'outer-banks': { key: 'destination:outer-banks:v1', src: '/brand/destinations/outer-banks.webp', title: "Outer Banks illustration" },
  'boston': { key: 'destination:boston:v1', src: '/brand/destinations/boston.webp', title: "Boston illustration" },
  'chicago': { key: 'destination:chicago:v1', src: '/brand/destinations/chicago.webp', title: "Chicago illustration" },
  'new-york': { key: 'destination:new-york:v1', src: '/brand/destinations/new-york.webp', title: "New York illustration" },
  'washington-dc': { key: 'destination:washington-dc:v1', src: '/brand/destinations/washington-dc.webp', title: "Washington DC illustration" },
  'orlando': { key: 'destination:orlando:v1', src: '/brand/destinations/orlando.webp', title: "Orlando illustration" },
  'key-west': { key: 'destination:key-west:v1', src: '/brand/destinations/key-west.webp', title: "Key West illustration" },
  'miami': { key: 'destination:miami:v1', src: '/brand/destinations/miami.webp', title: "Miami illustration" },
  'las-vegas': { key: 'destination:las-vegas:v1', src: '/brand/destinations/las-vegas.webp', title: "Las Vegas illustration" },
  'santa-fe': { key: 'destination:santa-fe:v1', src: '/brand/destinations/santa-fe.webp', title: "Santa Fe illustration" },
  'sedona': { key: 'destination:sedona:v1', src: '/brand/destinations/sedona.webp', title: "Sedona illustration" },
  'sonoma': { key: 'destination:sonoma:v1', src: '/brand/destinations/sonoma.webp', title: "Sonoma illustration" },
  'napa-valley': { key: 'destination:napa-valley:v1', src: '/brand/destinations/napa-valley.webp', title: "Napa Valley illustration" },
  'santa-barbara': { key: 'destination:santa-barbara:v1', src: '/brand/destinations/santa-barbara.webp', title: "Santa Barbara illustration" },
  'san-diego': { key: 'destination:san-diego:v1', src: '/brand/destinations/san-diego.webp', title: "San Diego illustration" },
  'palm-springs': { key: 'destination:palm-springs:v1', src: '/brand/destinations/palm-springs.webp', title: "Palm Springs illustration" },
  'san-antonio': { key: 'destination:san-antonio:v1', src: '/brand/destinations/san-antonio.webp', title: "San Antonio illustration" },
  'austin': { key: 'destination:austin:v1', src: '/brand/destinations/austin.webp', title: "Austin illustration" },
  'new-orleans': { key: 'destination:new-orleans:v1', src: '/brand/destinations/new-orleans.webp', title: "New Orleans illustration" },
  'nashville': { key: 'destination:nashville:v1', src: '/brand/destinations/nashville.webp', title: "Nashville illustration" },
  'savannah': { key: 'destination:savannah:v1', src: '/brand/destinations/savannah.webp', title: "Savannah illustration" },
  'charleston': { key: 'destination:charleston:v1', src: '/brand/destinations/charleston.webp', title: "Charleston illustration" },
  scottsdale: { key: 'destination:scottsdale:v1', src: '/brand/destinations/scottsdale.webp', title: 'Scottsdale illustration' },
  lisbon: { key: 'destination:lisbon:v1', src: '/brand/destinations/lisbon.webp', title: 'Lisbon illustration' },
  asheville: { key: 'destination:asheville:v1', src: '/brand/destinations/asheville.webp', title: 'Asheville illustration' },
};

export const templateArtwork: Record<string, LocalArtwork> = {
  'festival-trips': { key: 'template:music-pavilion:v1', src: '/brand/templates/music-pavilion.webp', title: "A music pavilion in the garden" },
  'cruise-groups': { key: 'template:harbor:v1', src: '/brand/templates/harbor.webp', title: "A welcoming harbor" },
  'retreats': { key: 'template:retreat-garden:v1', src: '/brand/templates/retreat-garden.webp', title: "A garden with room to reconnect" },
  'wedding-guest-travel': { key: 'template:wedding-gate:v2', src: '/brand/templates/wedding-gate-v2.webp', title: 'A garden gate opening toward a ceremony lawn' },
  'birthday-trips': { key: 'template:celebration-table:v1', src: '/brand/templates/celebration-table.webp', title: "A thoughtful celebration around a table" },
  'bachelor-trips': { key: 'template:bachelor-courtyard:v2', src: '/brand/templates/bachelor-courtyard-v2.webp', title: 'An evening courtyard supper' },
  'bachelorette-trips': { key: 'template:bachelorette-supper:v2', src: '/brand/templates/bachelorette-supper-v2.webp', title: 'An intimate garden celebration' },
  'road-trips': { key: 'template:coastal-road:v1', src: '/brand/templates/coastal-road.webp', title: "An unhurried road along the coast" },
  'camping-trips': { key: 'template:campsite:v1', src: '/brand/templates/campsite.webp', title: "A peaceful shared campsite" },
  'family-vacations': { key: 'template:family-cottage:v2', src: '/brand/templates/family-cottage-v2.webp', title: 'A cottage and a quiet beach path' },
  'beach-trips': { key: 'template:shared-shore:v1', src: '/brand/templates/shared-shore.webp', title: "A quiet shore for a shared vacation" },
  'ski-trips': { key: 'template:mountain-chalet:v1', src: '/brand/templates/mountain-chalet.webp', title: "A chalet for a shared ski weekend" },
  'golf-trips': { key: 'template:golf-landscape:v1', src: '/brand/templates/golf-landscape.webp', title: "A quiet coastal golf course" },
  'guys-trips': { key: 'template:guys-cabin:v2', src: '/brand/templates/guys-cabin-v2.webp', title: 'A lakeside cabin and canoe landing' },
  'girls-trips': { key: 'template:girls-breakfast:v2', src: '/brand/templates/girls-breakfast-v2.webp', title: 'Breakfast on a garden terrace' },
  'friends-trips': { key: 'template:friends-courtyard:v1', src: '/brand/templates/friends-courtyard.webp', title: "A courtyard ready for friends" },
  'family-reunions': { key: 'template:gathering:v1', src: '/brand/templates/gathering.webp', title: 'Gathering around a shared table' },
  'church-community-trips': { key: 'template:community-lodge:v2', src: '/brand/templates/community-lodge-v2.webp', title: 'A welcoming community lodge' },
};
export const genericArtwork: LocalArtwork[] = [
  { ...{ key: 'generic:mountains:v1', src: '/brand/templates/mountains.webp', title: "A quiet mountain landscape" }, key: 'generic:mountains:v1' },
  { key: 'generic:gathering:v1', src: '/brand/templates/gathering.webp', title: 'Gathering around a shared table' },
  { key: 'generic:coast:v1', src: '/brand/coast.webp', title: 'Coastal illustration' },
];

export function getTemplateArtwork(slug: string): (LocalArtwork & { status: 'reviewed' }) | null {
  const artwork = templateArtwork[slug];
  return artwork ? { ...artwork, status: 'reviewed' } : null;
}

export function resolveLocalArt(destinationSlug?: string, templateSlug?: string): LocalArtwork | null {
  if (destinationSlug && destinationArtwork[destinationSlug]) return destinationArtwork[destinationSlug];
  if (templateSlug && templateArtwork[templateSlug]) return templateArtwork[templateSlug];
  // Stable for a given entry context; the selected key is persisted by trip setup.
  const seed = `${destinationSlug ?? ''}:${templateSlug ?? ''}`;
  const hash = Array.from(seed).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return genericArtwork[hash % genericArtwork.length] ?? null;
}

export const supportArtwork: Record<string, LocalArtwork> = {
  'planning-table': { key: 'support:planning-table:v1', src: '/brand/templates/planning-table.webp', title: "A quiet place to plan together" },
  'harbor': { key: 'template:harbor:v1', src: '/brand/templates/harbor.webp', title: "A welcoming harbor" },};
/** Explicit editorial illustration mapping; unknown routes deliberately return null. */
export function getRouteArtwork(path:string):LocalArtwork|null {
 const route=path.replace(/^\/prototype\/trip-pilot\/discover\/?/,'').replace(/^\/+|\/+$/g,'');
 const guides:Record<string,string>={'guides/asheville-family-reunion':'asheville','guides/scottsdale-golf-trip':'scottsdale','guides/lisbon-chatgpt-trip':'lisbon','guides/gatlinburg-church-retreat':'gatlinburg'};
 if(guides[route])return destinationArtwork[guides[route]]??null;
 const scenes:Record<string,[string,string]>={
  'trip-templates':['templates-overview','A landscape of places to gather'],
  'group-trip-planner':['planner-arrival','Paths meeting at a coastal house'],
  'group-organizers':['organizer-porch','A thoughtfully prepared welcome porch'],
  'pricing':['pricing-terrace','A terrace table set for the group'],
  'destinations':['destinations-panorama','A coast, town and mountain panorama'],
  'partners/destinations':['destination-square','A welcoming town square'],
  'assistants/chatgpt':['chatgpt-map','A map and coffee beside the harbor'],
  'assistants/claude':['claude-notebook','A notebook beside a mountain window'],
  'assistants/gemini':['gemini-garden','A travel journal in a quiet garden pavilion'],
  'docs/assistant-handoff':['handoff-notebook','A map tucked into a travel notebook'],
  'partners/travel-assistants':['travel-partner-desk','A travel desk opening toward a garden']
 };
 if(scenes[route]){const [key,title]=scenes[route];return {key:`support:${key}:v2`,src:`/brand/templates/${key}-v2.webp`,title};}
 if(route==='assistants')return supportArtwork['planning-table']??null;
 if(route==='')return templateArtwork['family-reunions']??null;
 return null;
}

/** Complete reviewed library, deduplicated where pages share an illustration. */
export const commonsCoverArtwork = [...new Map([
  ...Object.values(destinationArtwork), ...Object.values(templateArtwork), ...genericArtwork,
  ...Object.values(supportArtwork),
  ...['trip-templates', 'group-trip-planner', 'group-organizers', 'pricing', 'destinations', 'partners/destinations', 'assistants/chatgpt', 'assistants/claude', 'assistants/gemini', 'docs/assistant-handoff', 'partners/travel-assistants'].map(getRouteArtwork).filter((art): art is LocalArtwork => art !== null),
].map(art => [art.src, art])).values()].sort((a, b) => a.title.localeCompare(b.title));

/** Presentation-only default. Explicitly selected covers always win at the call site. */
export function suggestTripCover(input: { locationNames?: readonly string[] | null; locationName?: string | null; title?: string | null }): LocalArtwork | null {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const contains = (text: string, phrase: string) => ` ${normalize(text)} `.includes(` ${normalize(phrase)} `);
  const locations = input.locationNames?.length ? input.locationNames : input.locationName ? [input.locationName] : [];
  const destinations = Object.entries(destinationArtwork).sort(([a], [b]) => b.length - a.length);
  for (const location of locations) {
    const match = destinations.find(([slug]) => contains(location, slug));
    if (match) return match[1];
  }
  // A known but unillustrated location must not be replaced by a city guessed from the title.
  if (!locations.length && input.title) {
    const match = destinations.find(([slug]) => contains(input.title!, slug));
    if (match) return match[1];
  }
  const title = input.title ?? "";
  const themes: [string[], string][] = [
    [["ski", "skiing", "snowboard"], "ski-trips"],
    [["beach", "coast", "seaside"], "beach-trips"],
    [["camping", "campsite"], "camping-trips"],
    [["golf", "golfing"], "golf-trips"],
    [["road trip"], "road-trips"],
    [["family reunion"], "family-reunions"],
  ];
  const theme = themes.find(([words]) => words.some(word => contains(title, word)));
  return theme ? templateArtwork[theme[1]] ?? null : locations.length ? genericArtwork[1] : null;
}
