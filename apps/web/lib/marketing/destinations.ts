/** Public destination planning content. No booking, timing or availability guarantees. */
export type DestinationSource = { title: string; url: string; fact: string; checkedAt: string; evidenceType?: "page" | "search-result" };
export type DestinationDefinition = {
  id: string; slug: string; name: string; region: string; templateSlug: string; query: string;
  coordinationQuestion: string; intro: string; base: string; arrivals: string;
  shared: string[]; optional: string[]; outline: string[]; sources: DestinationSource[];
  coverPath: string; artStatus: 'pending' | 'reviewed';
};
export const destinationCatalog: DestinationDefinition[] = [
  {
    "slug": "charleston",
    "region": "Southeast US",
    "base": "Choose between a downtown gathering and a beach-house trip before comparing stays. Keep the whole group in one practical area rather than scattering rooms across the coast.",
    "arrivals": "Ask who will have a car and which beach access point the group would actually use. Give late arrivals a direct check-in plan instead of requiring everyone to meet downtown.",
    "shared": [
      "A shared Lowcountry dinner with a reviewed headcount",
      "Compare house nights and shared parking costs before splitting them"
    ],
    "optional": [
      "A separate Folly Beach outing for people who want time by the water"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared Lowcountry dinner with a reviewed headcount",
      "Room to choose · A separate Folly Beach outing for people who want time by the water",
      "Before leaving · Compare house nights and shared parking costs before splitting them"
    ],
    "coordinationQuestion": "How do we keep a Charleston friends trip together when some people want downtown and others want the beach?",
    "intro": "Choose between a downtown gathering and a beach-house trip before comparing stays. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Explore Charleston beach FAQ",
        "url": "https://www.charlestoncvb.com/beaches/plan-your-trip/faq/",
        "fact": "Kiawah Island has public beach access at Beachwalker Park.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Explore Charleston beach FAQ",
        "url": "https://www.charlestoncvb.com/beaches/plan-your-trip/faq/",
        "fact": "The official beach FAQ distinguishes beach access and parking arrangements by beach town.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D01",
    "name": "Charleston",
    "templateSlug": "friends-trips",
    "query": "charleston girls trip",
    "coverPath": "/brand/destinations/charleston.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "savannah",
    "region": "Southeast US",
    "base": "Decide whether the stay centers on the Historic Landmark District or Tybee Island. Ask about stairs and walking preferences before treating a historic house as suitable for everyone.",
    "arrivals": "Collect arrival windows and keep the first gathering near the agreed stay. If some people want a Tybee day, confirm separate rides rather than assuming it is part of everyone's downtown plan.",
    "shared": [
      "A relaxed dinner near the shared stay",
      "Keep the beach excursion optional in both the schedule and cost split"
    ],
    "optional": [
      "A Tybee Island visit with its own headcount"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A relaxed dinner near the shared stay",
      "Room to choose · A Tybee Island visit with its own headcount",
      "Before leaving · Keep the beach excursion optional in both the schedule and cost split"
    ],
    "coordinationQuestion": "How do we organize a Savannah weekend with separate arrivals and an optional Tybee day?",
    "intro": "Decide whether the stay centers on the Historic Landmark District or Tybee Island. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Savannah neighborhoods",
        "url": "https://visitsavannah.com/neighborhoods-districts",
        "fact": "The official area guide distinguishes Savannah's Historic District from Tybee Island.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Savannah neighborhoods",
        "url": "https://visitsavannah.com/neighborhoods-districts",
        "fact": "Tybee Island is presented as a beach destination in the Savannah area.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D02",
    "name": "Savannah",
    "templateSlug": "friends-trips",
    "query": "savannah girls trip",
    "coverPath": "/brand/destinations/savannah.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "asheville",
    "region": "Southeast US",
    "base": "Compare a shared house with rooms in town using actual room and access needs. A cabin address should be reviewed separately from the places the family hopes to visit.",
    "arrivals": "Ask which households are driving, which are flying and who needs a ride. Confirm the check-in plan before promising a first-night meal to relatives arriving at different times.",
    "shared": [
      "Set one reunion meal with an agreed headcount and food requirements.",
      "Choose a common meeting point for a River Arts District visit."
    ],
    "optional": [
      "Browse working studios in smaller groups.",
      "Consider a French Broad River Greenway walk with a separate meeting point for those staying behind."
    ],
    "outline": [
      "Arrival · Staggered check-in and a simple family meal",
      "Reunion · Gather for the main meal, with a proposed arts outing before or after",
      "Departure · Divide clean-up and record the final shared grocery costs"
    ],
    "coordinationQuestion": "How do we organize an Asheville family reunion, collect availability, keep bookings together and split costs?",
    "intro": "A reunion needs one dependable plan across households. Start with dates and beds, then make the shared meal and the time together easy to join.",
    "sources": [
      {
        "title": "Explore Asheville: River Arts District",
        "url": "https://www.exploreasheville.com/places-to-go/river-arts-district/things-to-do",
        "fact": "The River Arts District includes working studios and galleries in former industrial buildings.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Explore Asheville: River Arts District activities",
        "url": "https://www.exploreasheville.com/places-to-go/river-arts-district/things-to-do",
        "fact": "The French Broad River Greenway offers a walking or cycling option alongside an arts visit.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D03",
    "name": "Asheville",
    "templateSlug": "family-reunions",
    "query": "asheville family reunion",
    "coverPath": "/brand/destinations/asheville.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "nashville",
    "region": "Southeast US",
    "base": "Compare Midtown and the downtown area around the places the group actually wants to meet. A celebration does not require everyone to stay near the loudest evening venues.",
    "arrivals": "Collect the hotel and arrival window for each traveler. Keep a first-night music plan optional until everyone confirms they can make it.",
    "shared": [
      "One celebration dinner with a confirmed guest list",
      "Split the stay separately from tickets and activities that only some people join"
    ],
    "optional": [
      "A music performance selected and booked independently"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · One celebration dinner with a confirmed guest list",
      "Room to choose · A music performance selected and booked independently",
      "Before leaving · Split the stay separately from tickets and activities that only some people join"
    ],
    "coordinationQuestion": "How do we organize a Nashville celebration without making every dinner and show mandatory?",
    "intro": "Compare Midtown and the downtown area around the places the group actually wants to meet. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Nashville Midtown",
        "url": "https://www.visitmusiccity.com/nashville-neighborhoods/midtown",
        "fact": "Midtown has a range of hotel options.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Nashville Midtown",
        "url": "https://www.visitmusiccity.com/nashville-neighborhoods/midtown",
        "fact": "Midtown is near downtown and other Nashville neighborhoods.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D04",
    "name": "Nashville",
    "templateSlug": "bachelorette-trips",
    "query": "nashville bachelorette",
    "coverPath": "/brand/destinations/nashville.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "new-orleans",
    "region": "Southeast US",
    "base": "Compare the French Quarter with a Garden District base using the group's pace and the evenings you intend to share. Keep the stay address and meeting place clear when people book separately.",
    "arrivals": "Record individual arrival times and where each traveler is staying. Agree on a specific pickup or meeting point rather than sending a broad neighborhood name.",
    "shared": [
      "A group meal followed by time to catch up",
      "Keep optional tickets and transport attached only to the people using them"
    ],
    "optional": [
      "A Garden District walk or a separate live-music evening"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A group meal followed by time to catch up",
      "Room to choose · A Garden District walk or a separate live-music evening",
      "Before leaving · Keep optional tickets and transport attached only to the people using them"
    ],
    "coordinationQuestion": "How do we coordinate a New Orleans weekend when friends book different hotels and join different activities?",
    "intro": "Compare the French Quarter with a Garden District base using the group's pace and the evenings you intend to share. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "New Orleans neighborhood maps",
        "url": "https://www.neworleans.com/plan/transportation/new-orleans-maps/",
        "fact": "The Garden District includes historic homes, gardens and neighborhood restaurants.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "New Orleans neighborhood maps",
        "url": "https://www.neworleans.com/plan/transportation/new-orleans-maps/",
        "fact": "The official guide notes that sidewalks in older neighborhoods can be uneven.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D05",
    "name": "New Orleans",
    "templateSlug": "bachelor-trips",
    "query": "new orleans bachelor party",
    "coverPath": "/brand/destinations/new-orleans.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "austin",
    "region": "South Central US",
    "base": "Choose a base around the group's main meal or event rather than trying to cover every Austin neighborhood. Compare South Congress and downtown against the actual stay addresses.",
    "arrivals": "Gather flights and driving plans before choosing a first-night start. Share the precise meeting address and decide whether anyone wants a shared ride.",
    "shared": [
      "A celebration meal everyone has opted into",
      "Track the house and shared meals separately from personal show tickets"
    ],
    "optional": [
      "A South Congress shopping walk or separately booked music night"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A celebration meal everyone has opted into",
      "Room to choose · A South Congress shopping walk or separately booked music night",
      "Before leaving · Track the house and shared meals separately from personal show tickets"
    ],
    "coordinationQuestion": "How do we organize an Austin celebration with one shared house, separate flights and individual show tickets?",
    "intro": "Choose a base around the group's main meal or event rather than trying to cover every Austin neighborhood. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Austin South Congress",
        "url": "https://www.austintexas.org/explore/entertainment-districts/south-congress/",
        "fact": "South Congress has shops, restaurants and cafés in a pedestrian-oriented district.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Austin South Congress",
        "url": "https://www.austintexas.org/explore/entertainment-districts/south-congress/",
        "fact": "The Continental Club on South Congress hosts live music.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D06",
    "name": "Austin",
    "templateSlug": "bachelor-trips",
    "query": "austin bachelor party",
    "coverPath": "/brand/destinations/austin.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "san-antonio",
    "region": "South Central US",
    "base": "Pick a River Walk section deliberately. A downtown-focused stay and a mission-focused outing have different meeting and transport needs.",
    "arrivals": "Collect arrival times and mobility preferences before planning a long group walk. Keep vehicle and meeting arrangements explicit for any mission visit.",
    "shared": [
      "A meal beside the River Walk with an agreed reservation headcount",
      "Let families choose their own paid attractions while keeping shared meals clear"
    ],
    "optional": [
      "A mission visit for the travelers who want a longer outing"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A meal beside the River Walk with an agreed reservation headcount",
      "Room to choose · A mission visit for the travelers who want a longer outing",
      "Before leaving · Let families choose their own paid attractions while keeping shared meals clear"
    ],
    "coordinationQuestion": "How do we plan a San Antonio family trip with different walking paces and a shared River Walk meal?",
    "intro": "Pick a River Walk section deliberately. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit San Antonio River Walk neighborhoods",
        "url": "https://www.visitsanantonio.com/blog/post/ultimate-guide-to-river-walk-neighborhoods/",
        "fact": "The River Walk has Downtown, Museum Reach and Mission Reach sections.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit San Antonio River Walk neighborhoods",
        "url": "https://www.visitsanantonio.com/blog/post/ultimate-guide-to-river-walk-neighborhoods/",
        "fact": "Mission Reach is a walking and cycling area and does not offer the downtown-style boat tours.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D07",
    "name": "San Antonio",
    "templateSlug": "family-vacations",
    "query": "san antonio family vacation",
    "coverPath": "/brand/destinations/san-antonio.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "scottsdale",
    "region": "Southwest US",
    "base": "Map the actual courses against the proposed house before choosing it. Decide whether proximity to the rounds or evenings in Old Town matters more, and confirm bedroom and vehicle needs.",
    "arrivals": "Collect airport, landing time and golf-bag needs for each golfer. Form ride groups only after the drivers and arrival windows are agreed; do not make a first-day tee time depend on an assumed landing.",
    "shared": [
      "Review the players for each proposed round separately.",
      "Agree on house and grocery splits before someone pays a deposit."
    ],
    "optional": [
      "An Old Town public-art walk for people sitting out a round.",
      "A separate final-day round only for travelers whose departures allow it."
    ],
    "outline": [
      "Arrival · Settle into the shared house and review rides",
      "First full day · Proposed round for confirmed players, then dinner together",
      "Second full day · Another optional round and unstructured time",
      "Departure · Review house costs and leave separate airport plans visible"
    ],
    "coordinationQuestion": "Eight golfers, different flights and one Scottsdale house: how do we organize rounds, rides and shared costs?",
    "intro": "Get the house, each round and the airport rides into one shared trip. People can join different rounds without being counted into every expense.",
    "sources": [
      {
        "title": "Experience Scottsdale: maps and guides",
        "url": "https://www.experiencescottsdale.com/maps-guides/",
        "fact": "The official visitor resources include a comparative golf-course chart.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Experience Scottsdale: Old Town walking maps",
        "url": "https://www.experiencescottsdale.com/maps-guides/",
        "fact": "The official maps include an Old Town public-art walking tour and a separate parking map.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D08",
    "name": "Scottsdale",
    "templateSlug": "golf-trips",
    "query": "scottsdale golf trip",
    "coverPath": "/brand/destinations/scottsdale.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "palm-springs",
    "region": "Southwest US",
    "base": "Use the exact town and house location when comparing stays. A listing elsewhere in Greater Palm Springs may not match a plan centered on Palm Springs itself.",
    "arrivals": "Collect flights, car seats and available seats before planning shared rides. Ask about the household's check-in time separately from airport arrival.",
    "shared": [
      "A shared-house dinner and an unhurried poolside gathering",
      "Agree which house supplies and meals are shared before making a shopping list"
    ],
    "optional": [
      "A separately reviewed Palm Springs Aerial Tramway outing"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared-house dinner and an unhurried poolside gathering",
      "Room to choose · A separately reviewed Palm Springs Aerial Tramway outing",
      "Before leaving · Agree which house supplies and meals are shared before making a shopping list"
    ],
    "coordinationQuestion": "How do we organize a Palm Springs house weekend and divide groceries, rides and optional outings?",
    "intro": "Use the exact town and house location when comparing stays. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Greater Palm Springs",
        "url": "https://www.visitgreaterpalmsprings.com/",
        "fact": "Greater Palm Springs includes nine cities, including Palm Springs, Palm Desert and La Quinta.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Greater Palm Springs",
        "url": "https://www.visitgreaterpalmsprings.com/",
        "fact": "The official visitor guide includes the Palm Springs Aerial Tramway among area attractions.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D09",
    "name": "Palm Springs",
    "templateSlug": "friends-trips",
    "query": "palm springs girls trip",
    "coverPath": "/brand/destinations/palm-springs.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "san-diego",
    "region": "West Coast US",
    "base": "Choose a neighborhood around the family's main gathering, then compare actual distances to proposed outings. Avoid asking every household to switch bases for each attraction.",
    "arrivals": "Gather arrival times, child-seat needs and who will have a vehicle. Keep the welcome meal near the stay so a delayed flight does not hold up the whole family.",
    "shared": [
      "A family meal with time for the children to settle in",
      "Keep museum and zoo admissions separate from common lodging and groceries"
    ],
    "optional": [
      "A Balboa Park museum visit chosen by each household"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A family meal with time for the children to settle in",
      "Room to choose · A Balboa Park museum visit chosen by each household",
      "Before leaving · Keep museum and zoo admissions separate from common lodging and groceries"
    ],
    "coordinationQuestion": "How do we coordinate a San Diego family vacation when households have different arrival times and attraction plans?",
    "intro": "Choose a neighborhood around the family's main gathering, then compare actual distances to proposed outings. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "San Diego Tourism Authority Balboa Park travel tips",
        "url": "https://www.sandiego.org/article/balboa-park-travel-tips",
        "fact": "Balboa Park is north of downtown San Diego.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "San Diego Tourism Authority Balboa Park travel tips",
        "url": "https://www.sandiego.org/article/balboa-park-travel-tips",
        "fact": "Its museums operate independently, so admission and opening arrangements vary by attraction.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D10",
    "name": "San Diego",
    "templateSlug": "family-vacations",
    "query": "san diego family vacation",
    "coverPath": "/brand/destinations/san-diego.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "santa-barbara",
    "region": "West Coast US",
    "base": "Compare a downtown stay with the waterfront and choose one common evening meeting area. Separate bedrooms and access needs matter more than putting everyone in the same building.",
    "arrivals": "Record whether people arrive by air, rail or car, with their actual arrival point. Agree on one welcome location so different arrival modes do not become several parallel plans.",
    "shared": [
      "Dinner together near the chosen base",
      "Keep individual tasting purchases apart from the shared trip ledger"
    ],
    "optional": [
      "A waterfront walk or a smaller visit to the Funk Zone"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · Dinner together near the chosen base",
      "Room to choose · A waterfront walk or a smaller visit to the Funk Zone",
      "Before leaving · Keep individual tasting purchases apart from the shared trip ledger"
    ],
    "coordinationQuestion": "How do we bring a Santa Barbara friends weekend together across train, air and car arrivals?",
    "intro": "Compare a downtown stay with the waterfront and choose one common evening meeting area. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Santa Barbara Funk Zone",
        "url": "https://santabarbaraca.com/explore-and-discover-santa-barbara/neighborhoods-towns/santa-barbara/the-funk-zone/",
        "fact": "The Funk Zone lies between downtown Santa Barbara and the waterfront.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Santa Barbara Funk Zone",
        "url": "https://santabarbaraca.com/explore-and-discover-santa-barbara/neighborhoods-towns/santa-barbara/the-funk-zone/",
        "fact": "MOXI, the Wolf Museum of Exploration and Innovation, is nearby.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D11",
    "name": "Santa Barbara",
    "templateSlug": "friends-trips",
    "query": "santa barbara girls trip",
    "coverPath": "/brand/destinations/santa-barbara.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "napa-valley",
    "region": "West Coast US",
    "base": "Choose the town before choosing the hotel. Compare Napa, Yountville and other valley bases against the actual reservations the group wants to make.",
    "arrivals": "Collect airport and arrival details before selecting a shared transfer. Confirm a driver or transport provider for a tasting outing independently; a proposed ride is not a booking.",
    "shared": [
      "One agreed dinner and a modest set of reviewed tasting plans",
      "Track shared transport with its riders and individual purchases separately"
    ],
    "optional": [
      "A town stroll or café afternoon for travelers skipping tastings"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · One agreed dinner and a modest set of reviewed tasting plans",
      "Room to choose · A town stroll or café afternoon for travelers skipping tastings",
      "Before leaving · Track shared transport with its riders and individual purchases separately"
    ],
    "coordinationQuestion": "How do we organize a Napa Valley group trip with shared transport and different tasting preferences?",
    "intro": "Choose the town before choosing the hotel. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Napa Valley towns and regions",
        "url": "https://www.visitnapavalley.com/things-to-do/towns-regions/",
        "fact": "Napa Valley's visitor guide identifies five towns: Calistoga, St. Helena, Yountville, Napa and American Canyon.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Napa Valley towns and regions",
        "url": "https://www.visitnapavalley.com/things-to-do/towns-regions/",
        "fact": "Its regional guide separately covers Angwin, Rutherford, Oakville and Lake Berryessa.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D12",
    "name": "Napa Valley",
    "templateSlug": "friends-trips",
    "query": "napa valley girls trip",
    "coverPath": "/brand/destinations/napa-valley.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "sonoma",
    "region": "West Coast US",
    "base": "Decide whether you mean Sonoma town or a broader Sonoma County trip. Choose one base first; a river-focused stay and a plaza-focused weekend need different daily plans.",
    "arrivals": "Collect airport choices and driver availability before offering shared pickups. Keep any tasting transport as a proposal until the driver or operator agrees.",
    "shared": [
      "One group dinner near the chosen stay",
      "Separate shared lodging from tasting fees and optional excursions"
    ],
    "optional": [
      "A Russian River park outing with its own participants"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · One group dinner near the chosen stay",
      "Room to choose · A Russian River park outing with its own participants",
      "Before leaving · Separate shared lodging from tasting fees and optional excursions"
    ],
    "coordinationQuestion": "How do we choose a Sonoma base and coordinate a weekend when not everyone wants every tasting?",
    "intro": "Decide whether you mean Sonoma town or a broader Sonoma County trip. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Sonoma County Tourism Riverfront Regional Park",
        "url": "https://www.sonomacounty.com/outdoor-activities/riverfront-regional-park/",
        "fact": "Riverfront Regional Park is near Windsor and Healdsburg along the Russian River.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Sonoma County Tourism Riverfront Regional Park",
        "url": "https://www.sonomacounty.com/outdoor-activities/riverfront-regional-park/",
        "fact": "Its Lake Trail circles Lake Benoist and has a spur toward the river.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D13",
    "name": "Sonoma",
    "templateSlug": "friends-trips",
    "query": "sonoma girls trip",
    "coverPath": "/brand/destinations/sonoma.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "sedona",
    "region": "Southwest US",
    "base": "Compare the stay with the retreat's main meeting place, not only the view. Ask about access and walking preferences before selecting hikes as a group activity.",
    "arrivals": "Gather arrivals and available vehicle seats. For a trail outing, review the current shuttle and trail conditions separately before fixing the meeting time.",
    "shared": [
      "A retreat meal and a short session with no mandatory excursion",
      "Keep optional guides and activities outside the common retreat split"
    ],
    "optional": [
      "A trailhead-shuttle outing selected for the people who want it"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A retreat meal and a short session with no mandatory excursion",
      "Room to choose · A trailhead-shuttle outing selected for the people who want it",
      "Before leaving · Keep optional guides and activities outside the common retreat split"
    ],
    "coordinationQuestion": "How do we organize a Sedona retreat with shared meals and optional outdoor activities?",
    "intro": "Compare the stay with the retreat's main meeting place, not only the view. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Sedona trailhead shuttles",
        "url": "https://visitsedona.com/blog/trailhead-shuttles-make-visiting-sedona-more-sustainable/",
        "fact": "Sedona has shuttle connections to trailheads including Cathedral Rock and Little Horse.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Sedona trailhead shuttles",
        "url": "https://visitsedona.com/blog/trailhead-shuttles-make-visiting-sedona-more-sustainable/",
        "fact": "The visitor guide points travelers to SedonaShuttle.com for current schedules and real-time information.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D14",
    "name": "Sedona",
    "templateSlug": "retreats",
    "query": "sedona retreat",
    "coverPath": "/brand/destinations/sedona.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "santa-fe",
    "region": "Southwest US",
    "base": "Compare a Plaza-area stay with the Railyard and choose one easy dinner meeting point. Keep art browsing flexible rather than scheduling the whole group into every gallery.",
    "arrivals": "Collect arrivals and the exact hotel or house addresses. Agree who wants a ride and who will meet independently at the first meal.",
    "shared": [
      "A welcome dinner and a shared check-in on the next day's plans",
      "Keep individual artwork, shopping and museum purchases separate from shared costs"
    ],
    "optional": [
      "Gallery browsing on Canyon Road in smaller groups"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A welcome dinner and a shared check-in on the next day's plans",
      "Room to choose · Gallery browsing on Canyon Road in smaller groups",
      "Before leaving · Keep individual artwork, shopping and museum purchases separate from shared costs"
    ],
    "coordinationQuestion": "How do we coordinate a Santa Fe arts weekend without scheduling everyone into the same galleries?",
    "intro": "Compare a Plaza-area stay with the Railyard and choose one easy dinner meeting point. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Tourism Santa Fe neighborhoods",
        "url": "https://www.santafe.org/visiting-santa-fe/neighborhoods/",
        "fact": "Canyon Road is an area of galleries.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Tourism Santa Fe neighborhoods",
        "url": "https://www.santafe.org/visiting-santa-fe/neighborhoods/",
        "fact": "The Railyard, Baca and Guadalupe districts feature contemporary visual and performing arts.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D15",
    "name": "Santa Fe",
    "templateSlug": "friends-trips",
    "query": "santa fe girls trip",
    "coverPath": "/brand/destinations/santa-fe.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "las-vegas",
    "region": "Southwest US",
    "base": "Choose a base around the event or dinner that brings the group together. Treat the Strip and Downtown as distinct options rather than assuming everyone can casually meet anywhere.",
    "arrivals": "Gather each hotel's name as well as the arrival time. Specify the actual lobby or pickup point, since a shared hotel name alone may not be enough for a large property.",
    "shared": [
      "One celebration dinner before the agreed event",
      "Keep personal gaming and entertainment spending out of shared expenses"
    ],
    "optional": [
      "An independently booked show for a smaller group"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · One celebration dinner before the agreed event",
      "Room to choose · An independently booked show for a smaller group",
      "Before leaving · Keep personal gaming and entertainment spending out of shared expenses"
    ],
    "coordinationQuestion": "How do we organize a Las Vegas group trip around one event while keeping individual spending separate?",
    "intro": "Choose a base around the event or dinner that brings the group together. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Las Vegas walking the Strip",
        "url": "https://www.visitlasvegas.com/experience/post/walking-the-las-vegas-strip/",
        "fact": "The Deuce bus connects the Strip with Downtown Las Vegas and Fremont Street.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Las Vegas walking the Strip",
        "url": "https://www.visitlasvegas.com/experience/post/walking-the-las-vegas-strip/",
        "fact": "The visitor guide suggests splitting a Strip walk into north and south sections.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D16",
    "name": "Las Vegas",
    "templateSlug": "bachelor-trips",
    "query": "las vegas bachelor party",
    "coverPath": "/brand/destinations/las-vegas.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "miami",
    "region": "Southeast US",
    "base": "Choose between a beach-focused base and a city-neighborhood stay before anyone commits. Use real addresses to compare shared outings across Miami and Miami Beach.",
    "arrivals": "Collect the airport as well as landing time for every traveler. Decide whether to share an arrival ride only when its travelers and destination are clear.",
    "shared": [
      "A group dinner near the agreed stay",
      "Assign transport costs to actual riders rather than everyone on the invitation"
    ],
    "optional": [
      "A neighborhood outing chosen separately from beach time"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A group dinner near the agreed stay",
      "Room to choose · A neighborhood outing chosen separately from beach time",
      "Before leaving · Assign transport costs to actual riders rather than everyone on the invitation"
    ],
    "coordinationQuestion": "How do we coordinate a Miami group trip when travelers stay in different neighborhoods and book their own flights?",
    "intro": "Choose between a beach-focused base and a city-neighborhood stay before anyone commits. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Greater Miami and Miami Beach neighborhoods",
        "url": "https://www.miamiandbeaches.com/neighborhoods",
        "fact": "The destination guide distinguishes Downtown Miami, Brickell and Coconut Grove.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Greater Miami and Miami Beach neighborhoods",
        "url": "https://www.miamiandbeaches.com/neighborhoods",
        "fact": "It also lists Miami Beach areas separately from mainland neighborhoods.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D17",
    "name": "Miami",
    "templateSlug": "bachelorette-trips",
    "query": "miami bachelorette",
    "coverPath": "/brand/destinations/miami.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "key-west",
    "region": "Southeast US",
    "base": "Choose a meeting base near the part of Key West you want to share. Compare the actual lodging locations with the Historic Seaport and downtown rather than assuming all stays are adjacent.",
    "arrivals": "Record whether travelers fly, drive or arrive by ferry. Keep arrival points visible and confirm who will collect house keys before the welcome meal.",
    "shared": [
      "An unhurried dinner with the whole group",
      "Split the stay and shared groceries separately from boat tickets"
    ],
    "optional": [
      "A separately booked outing departing from the Historic Seaport"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · An unhurried dinner with the whole group",
      "Room to choose · A separately booked outing departing from the Historic Seaport",
      "Before leaving · Split the stay and shared groceries separately from boat tickets"
    ],
    "coordinationQuestion": "How do we organize a Key West trip when some friends fly, some drive and others arrive by ferry?",
    "intro": "Choose a meeting base near the part of Key West you want to share. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Florida Keys Tourism Council getting to Key West",
        "url": "https://visitfloridakeys.com/plan-your-trip/plan-book/getting-here-around/how-to-get-here",
        "fact": "Key West has an international airport served by passenger flights.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Florida Keys Tourism Council getting to Key West",
        "url": "https://visitfloridakeys.com/plan-your-trip/plan-book/getting-here-around/how-to-get-here",
        "fact": "Passenger ferries dock at the Key West Bight Ferry Terminal in the Historic Seaport District.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D18",
    "name": "Key West",
    "templateSlug": "friends-trips",
    "query": "key west group trip",
    "coverPath": "/brand/destinations/key-west.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "orlando",
    "region": "Southeast US",
    "base": "Choose the stay around the parks or neighborhoods your households actually plan to visit. Agree which days are shared before buying tickets independently.",
    "arrivals": "Gather flight details, child-seat needs and car plans. Ask each household which meals they will join; staying on the same trip does not mean identical park days.",
    "shared": [
      "One family meal on a day without a tightly timed park arrival",
      "Separate each household's tickets from common groceries and accommodation"
    ],
    "optional": [
      "A smaller neighborhood outing for people taking a park break"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · One family meal on a day without a tightly timed park arrival",
      "Room to choose · A smaller neighborhood outing for people taking a park break",
      "Before leaving · Separate each household's tickets from common groceries and accommodation"
    ],
    "coordinationQuestion": "How do we organize an Orlando family trip when each household wants different park days?",
    "intro": "Choose the stay around the parks or neighborhoods your households actually plan to visit. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Orlando neighborhoods",
        "url": "https://www.visitorlando.com/things-to-do/beyond-theme-parks/neighborhoods/",
        "fact": "Orlando's destination guide includes distinct Main Street Districts beyond the theme parks.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Orlando neighborhoods",
        "url": "https://www.visitorlando.com/things-to-do/beyond-theme-parks/neighborhoods/",
        "fact": "It also covers nearby Winter Park, Winter Garden and the historic town of Eatonville.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D19",
    "name": "Orlando",
    "templateSlug": "family-reunions",
    "query": "orlando family reunion",
    "coverPath": "/brand/destinations/orlando.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "washington-dc",
    "region": "Northeast US",
    "base": "Compare stays by the group's main museum or gathering plans and access to transit. Ask about walking pace; one day does not need to cover the entire Mall.",
    "arrivals": "Record the exact airport or rail station, not just Washington. Let travelers choose their arrival route, then set a common meeting point at the stay.",
    "shared": [
      "A meal and one selected museum visit with entry requirements checked",
      "Keep individual admissions and transit apart from agreed group meals"
    ],
    "optional": [
      "Additional memorial or gallery visits in smaller groups"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A meal and one selected museum visit with entry requirements checked",
      "Room to choose · Additional memorial or gallery visits in smaller groups",
      "Before leaving · Keep individual admissions and transit apart from agreed group meals"
    ],
    "coordinationQuestion": "How do we coordinate a Washington, DC group visit with different arrival stations, museum plans and walking paces?",
    "intro": "Compare stays by the group's main museum or gathering plans and access to transit. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Destination DC Metro guide",
        "url": "https://washington.org/navigating-dc-metro",
        "fact": "Smithsonian station is on the Orange, Silver and Blue Metro lines.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Destination DC Metro guide",
        "url": "https://washington.org/navigating-dc-metro",
        "fact": "Gallery Place-Chinatown is served by the Red, Green and Yellow lines.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D20",
    "name": "Washington DC",
    "templateSlug": "friends-trips",
    "query": "washington dc group trip",
    "coverPath": "/brand/destinations/washington-dc.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "new-york",
    "region": "Northeast US",
    "base": "Choose a shared meeting neighborhood around the main event. Compare actual addresses across boroughs and avoid using Manhattan as a substitute for a precise location.",
    "arrivals": "Collect airport or station and arrival time for each person. Agree who travels independently to the stay instead of forcing a single pickup across different arrival points.",
    "shared": [
      "One booked group meal and a clear meeting place before the main event",
      "Separate show tickets and personal transit from the shared stay"
    ],
    "optional": [
      "A Queens food outing or independent museum afternoon"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · One booked group meal and a clear meeting place before the main event",
      "Room to choose · A Queens food outing or independent museum afternoon",
      "Before leaving · Separate show tickets and personal transit from the shared stay"
    ],
    "coordinationQuestion": "How do we organize a New York friends trip with different airports, hotels and show tickets?",
    "intro": "Choose a shared meeting neighborhood around the main event. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "NYC Tourism exploring Queens",
        "url": "https://www.business.nyctourism.com/press-media/press-releases/nyc-company-invites-visitors-to-explore-queens-like-a-new-yorker",
        "fact": "The No. 7 subway line is one way to explore Queens.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "NYC Tourism exploring Queens",
        "url": "https://www.business.nyctourism.com/press-media/press-releases/nyc-company-invites-visitors-to-explore-queens-like-a-new-yorker",
        "fact": "Jackson Heights and Flushing are Queens neighborhoods featured for food in the official visitor guide.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D21",
    "name": "New York",
    "templateSlug": "friends-trips",
    "query": "new york group trip",
    "coverPath": "/brand/destinations/new-york.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "chicago",
    "region": "Midwest US",
    "base": "Choose a base around the group's main gathering and compare transit connections to other interests. Do not plan every meal downtown if the event is elsewhere.",
    "arrivals": "Record each airport or train station alongside the arrival window. Set one meeting address and keep optional early-arrival plans separate.",
    "shared": [
      "A welcome dinner and a shared riverfront meeting",
      "Keep optional tour tickets and rentals out of the whole-group split"
    ],
    "optional": [
      "A lakefront walk or cycling outing for those interested; check the Park District’s current repair closures before choosing a section."
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A welcome dinner and a shared riverfront meeting",
      "Room to choose · A lakefront walk or cycling outing for those interested; check the Park District’s current repair closures before choosing a section.",
      "Before leaving · Keep optional tour tickets and rentals out of the whole-group split"
    ],
    "coordinationQuestion": "How do we coordinate a Chicago weekend with separate arrivals and one shared event?",
    "intro": "Choose a base around the group's main gathering and compare transit connections to other interests. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Chicago Park District Lakefront Trail",
        "url": "https://www.chicagoparkdistrict.com/lakefront-trail",
        "fact": "Chicago has separate lakefront routes for cyclists and pedestrians.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Chicago Park District Lakefront Trail",
        "url": "https://www.chicagoparkdistrict.com/lakefront-trail",
        "fact": "The Lakefront Trail extends from Ardmore Avenue to 71st Street.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D22",
    "name": "Chicago",
    "templateSlug": "friends-trips",
    "query": "chicago group trip",
    "coverPath": "/brand/destinations/chicago.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "boston",
    "region": "Northeast US",
    "base": "Compare the stay with the main meal and the part of the Freedom Trail the group wants to explore. Agree on a manageable section instead of treating the entire route as compulsory.",
    "arrivals": "Collect air, rail and driving arrivals separately. Confirm where luggage can wait before promising an activity before check-in.",
    "shared": [
      "A meal and a short shared history walk",
      "Keep tours and museum entries optional with their own attendees"
    ],
    "optional": [
      "More Freedom Trail stops for people who want a longer walk"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A meal and a short shared history walk",
      "Room to choose · More Freedom Trail stops for people who want a longer walk",
      "Before leaving · Keep tours and museum entries optional with their own attendees"
    ],
    "coordinationQuestion": "How do we organize a Boston family trip with a manageable shared walk and optional museum visits?",
    "intro": "Compare the stay with the main meal and the part of the Freedom Trail the group wants to explore. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Meet Boston Freedom Trail",
        "url": "https://www.meetboston.com/things-to-do/sightseeing-and-tours/walking-tours/the-freedom-trail/",
        "fact": "The Freedom Trail is a 2.5-mile route connecting 16 historic sites.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Meet Boston Freedom Trail",
        "url": "https://www.meetboston.com/things-to-do/sightseeing-and-tours/walking-tours/the-freedom-trail/",
        "fact": "It passes through Downtown, the North End and Charlestown.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D23",
    "name": "Boston",
    "templateSlug": "friends-trips",
    "query": "boston group trip",
    "coverPath": "/brand/destinations/boston.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "outer-banks",
    "region": "Southeast US",
    "base": "Choose the town and exact house before sharing a general Outer Banks plan. Compare bedroom needs, beach access and the places the group wants to visit.",
    "arrivals": "Gather driving routes and expected arrival windows. If the plan involves a ferry, check the operator's current service and give that leg its own coordination step.",
    "shared": [
      "A house dinner with a shared grocery list",
      "Review unequal nights before dividing the house cost"
    ],
    "optional": [
      "A separately agreed lighthouse or village outing"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A house dinner with a shared grocery list",
      "Room to choose · A separately agreed lighthouse or village outing",
      "Before leaving · Review unequal nights before dividing the house cost"
    ],
    "coordinationQuestion": "How do we organize an Outer Banks house trip when families arrive on different days?",
    "intro": "Choose the town and exact house before sharing a general Outer Banks plan. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Outer Banks Hatteras Island guide",
        "url": "https://www.outerbanks.org/plan-your-trip/explore/the-islands/hatteras-island/",
        "fact": "Hatteras Island includes the villages of Rodanthe, Waves, Salvo, Avon, Buxton, Frisco and Hatteras.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Outer Banks Hatteras Island guide",
        "url": "https://www.outerbanks.org/plan-your-trip/explore/the-islands/hatteras-island/",
        "fact": "Cape Hatteras National Seashore is part of the island's visitor landscape.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D24",
    "name": "Outer Banks",
    "templateSlug": "family-reunions",
    "query": "outer banks family reunion",
    "coverPath": "/brand/destinations/outer-banks.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "hilton-head",
    "region": "Southeast US",
    "base": "Pick a stay around the beach access the group intends to use. Confirm rules and access for the actual property before assuming a rental includes every nearby facility.",
    "arrivals": "Ask who is driving and who wants a shared pickup. Agree on a house check-in contact and keep the first grocery trip separate from each person's arrival.",
    "shared": [
      "A beach-house dinner with household contributions agreed",
      "Keep golf, bikes and other optional rentals with their users"
    ],
    "optional": [
      "A cycling outing selected for the willing riders"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A beach-house dinner with household contributions agreed",
      "Room to choose · A cycling outing selected for the willing riders",
      "Before leaving · Keep golf, bikes and other optional rentals with their users"
    ],
    "coordinationQuestion": "How do we coordinate a Hilton Head vacation with a shared house and optional golf or bike outings?",
    "intro": "Pick a stay around the beach access the group intends to use. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Hilton Head Island outdoor recreation",
        "url": "https://www.hiltonheadisland.org/see-do/outdoors-recreation",
        "fact": "Hilton Head has a network of paved leisure pathways.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Hilton Head Island outdoor recreation",
        "url": "https://www.hiltonheadisland.org/see-do/outdoors-recreation",
        "fact": "The visitor guide lists Sea Pines Forest Preserve as an outdoor place to explore.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D25",
    "name": "Hilton Head",
    "templateSlug": "golf-trips",
    "query": "hilton head golf trip",
    "coverPath": "/brand/destinations/hilton-head.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "myrtle-beach",
    "region": "Southeast US",
    "base": "Choose the community before the accommodation. North Myrtle Beach, Myrtle Beach and Surfside Beach should be compared against the activities your group actually wants.",
    "arrivals": "Collect each household's arrival day and vehicle plan. Keep one check-in address and a clear grocery handoff when stays overlap only partly.",
    "shared": [
      "A family meal and an easy shared beach session",
      "Split house nights fairly and record optional activities with their participants"
    ],
    "optional": [
      "A smaller golf or attraction outing booked separately"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A family meal and an easy shared beach session",
      "Room to choose · A smaller golf or attraction outing booked separately",
      "Before leaving · Split house nights fairly and record optional activities with their participants"
    ],
    "coordinationQuestion": "How do we organize a Myrtle Beach family vacation and split costs fairly across unequal stays?",
    "intro": "Choose the community before the accommodation. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Myrtle Beach communities",
        "url": "https://www.visitmyrtlebeach.com/beaches-communities",
        "fact": "The Grand Strand guide covers 14 communities.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Myrtle Beach communities",
        "url": "https://www.visitmyrtlebeach.com/beaches-communities",
        "fact": "Garden City Beach is directly south of Surfside Beach.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D26",
    "name": "Myrtle Beach",
    "templateSlug": "golf-trips",
    "query": "myrtle beach golf trip",
    "coverPath": "/brand/destinations/myrtle-beach.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "destin",
    "region": "Southeast US",
    "base": "Compare Destin and the Fort Walton Beach area around your intended beach access. Check the actual property's access instructions instead of assuming all sand in front of a rental is public.",
    "arrivals": "Record the arrival airport or driving plan for each household. Choose who will handle check-in and groceries, then leave late arrivals a simple route to the stay.",
    "shared": [
      "A shared beach-house meal with clear grocery responsibilities",
      "Assign charter and rental expenses only to the people who opted in"
    ],
    "optional": [
      "A separately booked fishing or water outing"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared beach-house meal with clear grocery responsibilities",
      "Room to choose · A separately booked fishing or water outing",
      "Before leaving · Assign charter and rental expenses only to the people who opted in"
    ],
    "coordinationQuestion": "How do we organize a Destin beach trip with shared groceries and a fishing outing only some people join?",
    "intro": "Compare Destin and the Fort Walton Beach area around your intended beach access. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Destin-Fort Walton Beach public beach access",
        "url": "https://www.destinfwb.com/explore/beaches/public-beach-access/",
        "fact": "The official visitor site provides a public beach access guide.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Destin-Fort Walton Beach public beach access",
        "url": "https://www.destinfwb.com/explore/beaches/public-beach-access/",
        "fact": "It distinguishes Destin access points from Fort Walton Beach and Okaloosa Island access points.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D27",
    "name": "Destin",
    "templateSlug": "family-reunions",
    "query": "destin family reunion",
    "coverPath": "/brand/destinations/destin.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "gulf-shores",
    "region": "Southeast US",
    "base": "Compare Gulf Shores, Orange Beach and Fort Morgan using the actual stay location and your group's priorities. A house farther along the coast needs a different meeting plan.",
    "arrivals": "Collect each car's arrival window and the lodging check-in instructions. Keep a shared shopping list so several households do not buy the same supplies.",
    "shared": [
      "Dinner at the house and an agreed beach meeting point",
      "Keep admission and optional excursions separate from common groceries"
    ],
    "optional": [
      "A Fort Morgan history visit for interested travelers"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · Dinner at the house and an agreed beach meeting point",
      "Room to choose · A Fort Morgan history visit for interested travelers",
      "Before leaving · Keep admission and optional excursions separate from common groceries"
    ],
    "coordinationQuestion": "How do we coordinate a Gulf Shores house trip across several households without duplicating groceries or plans?",
    "intro": "Compare Gulf Shores, Orange Beach and Fort Morgan using the actual stay location and your group's priorities. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Alabama's Beaches Fort Morgan",
        "url": "https://www.gulfshores.com/things-to-do/fort-morgan/",
        "fact": "Fort Morgan is a historic masonry fort at the meeting of Mobile Bay and the Gulf.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Alabama's Beaches Fort Morgan",
        "url": "https://www.gulfshores.com/things-to-do/fort-morgan/",
        "fact": "The site also has nature areas and a boat launch.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D28",
    "name": "Gulf Shores",
    "templateSlug": "family-reunions",
    "query": "gulf shores family reunion",
    "coverPath": "/brand/destinations/gulf-shores.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "cape-cod",
    "region": "Northeast US",
    "base": "Choose the Cape town before choosing the house. A trip centered on the Outer Cape and a visit based nearer the bridges should not share an assumed daily route.",
    "arrivals": "Collect driving, ferry or air plans and the exact arrival point. Confirm whether an island side trip is actually part of the group plan before adding ferry costs.",
    "shared": [
      "A house supper and one shared beach day",
      "Record unequal house nights and keep optional ferry tickets individual"
    ],
    "optional": [
      "A separate National Seashore outing with a reviewed meeting point"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A house supper and one shared beach day",
      "Room to choose · A separate National Seashore outing with a reviewed meeting point",
      "Before leaving · Record unequal house nights and keep optional ferry tickets individual"
    ],
    "coordinationQuestion": "How do we organize a Cape Cod group vacation with different house nights and optional island trips?",
    "intro": "Choose the Cape town before choosing the house. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Cape Cod Chamber Cape and Islands",
        "url": "https://www.capecodchamber.org/cape-and-islands/",
        "fact": "Cape Cod comprises 15 towns.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Cape Cod Chamber Cape and Islands",
        "url": "https://www.capecodchamber.org/cape-and-islands/",
        "fact": "Martha's Vineyard and Nantucket are separate island destinations reached by ferry or air.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D29",
    "name": "Cape Cod",
    "templateSlug": "family-reunions",
    "query": "cape cod family reunion",
    "coverPath": "/brand/destinations/cape-cod.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "gatlinburg",
    "region": "Southeast US",
    "base": "Compare the retreat house with the actual gathering room and downtown access. Ask about beds, stairs and parking before selecting a cabin for a church or community group.",
    "arrivals": "Collect drivers, seats and arrival windows by household. Make one person responsible for check-in and share a reviewed address rather than a vague cabin-area pin.",
    "shared": [
      "A retreat meal and a short gathering with a clear start",
      "Separate optional attractions from the retreat's agreed common costs"
    ],
    "optional": [
      "A downtown visit using the trolley where the route fits"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A retreat meal and a short gathering with a clear start",
      "Room to choose · A downtown visit using the trolley where the route fits",
      "Before leaving · Separate optional attractions from the retreat's agreed common costs"
    ],
    "coordinationQuestion": "How do we organize a Gatlinburg church retreat, gather responses and keep shared expenses clear?",
    "intro": "Compare the retreat house with the actual gathering room and downtown access. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Gatlinburg trolley guide",
        "url": "https://www.gatlinburg.com/things-to-do/trolley/",
        "fact": "Gatlinburg operates a trolley system with published routes.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Gatlinburg trolley guide",
        "url": "https://www.gatlinburg.com/things-to-do/trolley/",
        "fact": "The Gatlinburg Welcome Center has a Park-n-Ride lot for trolley access.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D30",
    "name": "Gatlinburg",
    "templateSlug": "family-reunions",
    "query": "gatlinburg family reunion",
    "coverPath": "/brand/destinations/gatlinburg.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "lake-tahoe",
    "region": "Mountain West US",
    "base": "Choose the shore and specific town before the house. Compare the intended resort or water outing with the base rather than treating every Tahoe address as interchangeable.",
    "arrivals": "Gather arrival airports, vehicle capacity and winter-equipment plans where relevant. Recheck current road conditions through official sources before agreeing on pickups.",
    "shared": [
      "A shared-house meal and a clear meeting point for the next day",
      "Divide lodging and groceries separately from lift tickets and rentals"
    ],
    "optional": [
      "A separate mountain or lake outing with its own participants"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared-house meal and a clear meeting point for the next day",
      "Room to choose · A separate mountain or lake outing with its own participants",
      "Before leaving · Divide lodging and groceries separately from lift tickets and rentals"
    ],
    "coordinationQuestion": "How do we coordinate a Lake Tahoe house trip when the group wants different mountain and lake activities?",
    "intro": "Choose the shore and specific town before the house. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Lake Tahoe regional guide",
        "url": "https://visitlaketahoe.com/travel/lake-tahoe-region-explained/",
        "fact": "North Lake Tahoe includes communities such as Incline Village, Tahoe City and Kings Beach.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Lake Tahoe regional guide",
        "url": "https://visitlaketahoe.com/travel/lake-tahoe-region-explained/",
        "fact": "Heavenly is in South Lake Tahoe, while Homewood is on the West Shore.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D31",
    "name": "Lake Tahoe",
    "templateSlug": "family-reunions",
    "query": "lake tahoe family reunion",
    "coverPath": "/brand/destinations/lake-tahoe.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "park-city",
    "region": "Mountain West US",
    "base": "Compare the stay with the resort base and bus stop you expect to use. Confirm sleeping arrangements before debating how many ski days everyone should buy.",
    "arrivals": "Collect flights and luggage needs before combining airport rides. Let each person arrange passes or lessons, then record the relevant times without assuming the whole group skis together.",
    "shared": [
      "A shared dinner after separate mountain days",
      "Split house and groceries separately from passes, lessons and equipment"
    ],
    "optional": [
      "A town afternoon for travelers skipping the slopes"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared dinner after separate mountain days",
      "Room to choose · A town afternoon for travelers skipping the slopes",
      "Before leaving · Split house and groceries separately from passes, lessons and equipment"
    ],
    "coordinationQuestion": "How do we organize a Park City ski trip while keeping non-skiers, separate passes and shared house costs clear?",
    "intro": "Compare the stay with the resort base and bus stop you expect to use. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Park City frequently asked questions",
        "url": "https://www.visitparkcity.com/about-park-city/frequently-asked-questions/",
        "fact": "Park City Transit and High Valley Transit provide a free year-round bus system.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Park City frequently asked questions",
        "url": "https://www.visitparkcity.com/about-park-city/frequently-asked-questions/",
        "fact": "Resort-base parking can require a reservation and fee in winter.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D32",
    "name": "Park City",
    "templateSlug": "ski-trips",
    "query": "park city ski trip",
    "coverPath": "/brand/destinations/park-city.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "breckenridge",
    "region": "Mountain West US",
    "base": "Compare the house with the actual lift or bus access and review the walk with luggage. Keep bedrooms and transport plans clear for non-skiers as well as skiers.",
    "arrivals": "Gather arrival windows and equipment needs before assigning rides. Confirm airport transport with its provider independently, then store the agreed details.",
    "shared": [
      "Dinner together after different mountain plans",
      "Keep lift tickets and lessons outside shared household expenses"
    ],
    "optional": [
      "A Main Street afternoon or an independently arranged lesson"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · Dinner together after different mountain plans",
      "Room to choose · A Main Street afternoon or an independently arranged lesson",
      "Before leaving · Keep lift tickets and lessons outside shared household expenses"
    ],
    "coordinationQuestion": "How do we coordinate a Breckenridge ski house with different flights, lessons and shared meals?",
    "intro": "Compare the house with the actual lift or bus access and review the walk with luggage. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "GoBreck vacation FAQ",
        "url": "https://gobreck.com/plan/breckenridge-vacation-faqs/",
        "fact": "The BreckConnect gondola links town to the base of Peak 8.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "GoBreck vacation FAQ",
        "url": "https://gobreck.com/plan/breckenridge-vacation-faqs/",
        "fact": "The visitor guide provides links to the Free Ride and Summit Stage transit maps.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D33",
    "name": "Breckenridge",
    "templateSlug": "ski-trips",
    "query": "breckenridge ski trip",
    "coverPath": "/brand/destinations/breckenridge.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "vail",
    "region": "Mountain West US",
    "base": "Choose between Vail Village, Lionshead and other stay areas based on the group's real meeting plan. Check the closest stop and lodging access before assuming every stay is slopeside.",
    "arrivals": "Collect airport and landing time separately for each traveler. Match shared transfers by actual luggage capacity and arrival window, with a fallback for delayed flights.",
    "shared": [
      "A village dinner with a headcount independent of ski participation",
      "Keep shared transfer costs assigned to the riders on that transfer"
    ],
    "optional": [
      "A separate non-skiing afternoon or individually booked mountain activity"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A village dinner with a headcount independent of ski participation",
      "Room to choose · A separate non-skiing afternoon or individually booked mountain activity",
      "Before leaving · Keep shared transfer costs assigned to the riders on that transfer"
    ],
    "coordinationQuestion": "How do we organize a Vail group trip with separate airport transfers and stays in different villages?",
    "intro": "Choose between Vail Village, Lionshead and other stay areas based on the group's real meeting plan. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Discover Vail group transportation",
        "url": "https://discovervail.com/meetings-conferences/transportation/",
        "fact": "The Town of Vail bus is free to ride.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Discover Vail group transportation",
        "url": "https://discovervail.com/meetings-conferences/transportation/",
        "fact": "It connects Vail Village, Lionshead Village and surrounding areas.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D34",
    "name": "Vail",
    "templateSlug": "ski-trips",
    "query": "vail ski trip",
    "coverPath": "/brand/destinations/vail.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "steamboat-springs",
    "region": "Mountain West US",
    "base": "Compare a downtown stay with a mountain-area stay. Decide whether the group's main priority is evenings together or access to individual mountain plans.",
    "arrivals": "Collect each arrival airport, time and luggage needs. Keep airport travel and local bus travel as separate arrangements so nobody assumes one covers the other.",
    "shared": [
      "A shared dinner after separate daytime activities",
      "Split the common stay and groceries separately from personal equipment"
    ],
    "optional": [
      "A downtown afternoon for people taking a rest day"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared dinner after separate daytime activities",
      "Room to choose · A downtown afternoon for people taking a rest day",
      "Before leaving · Split the common stay and groceries separately from personal equipment"
    ],
    "coordinationQuestion": "How do we coordinate a Steamboat Springs ski weekend when some friends stay downtown and others near the mountain?",
    "intro": "Compare a downtown stay with a mountain-area stay. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "City of Steamboat Springs getting around",
        "url": "https://steamboatsprings.net/1240/Getting-Around",
        "fact": "Steamboat Springs has a free city bus system.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "City of Steamboat Springs getting around",
        "url": "https://steamboatsprings.net/1240/Getting-Around",
        "fact": "That system connects the ski area, downtown and many lodging and grocery locations.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D35",
    "name": "Steamboat Springs",
    "templateSlug": "ski-trips",
    "query": "steamboat springs ski trip",
    "coverPath": "/brand/destinations/steamboat-springs.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "jackson-hole",
    "region": "Mountain West US",
    "base": "Compare the Town of Jackson with Teton Village before reserving rooms. Use the actual destination of each outing to decide where the whole group meets.",
    "arrivals": "Collect airport details and who has a vehicle. Review current road and park access separately before turning a proposed outing into a firm plan.",
    "shared": [
      "A dinner together near the chosen base",
      "Keep independent guides, passes and equipment with the people using them"
    ],
    "optional": [
      "A separately reviewed park or mountain outing"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A dinner together near the chosen base",
      "Room to choose · A separately reviewed park or mountain outing",
      "Before leaving · Keep independent guides, passes and equipment with the people using them"
    ],
    "coordinationQuestion": "How do we choose a Jackson Hole group base and keep independent mountain plans in one shared trip?",
    "intro": "Compare the Town of Jackson with Teton Village before reserving rooms. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Jackson Hole Teton Village",
        "url": "https://visitjacksonhole.com/plan/places/teton-village",
        "fact": "Teton Village offers slopeside lodging.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Jackson Hole Teton Village",
        "url": "https://visitjacksonhole.com/plan/places/teton-village",
        "fact": "The village also provides access to summer hiking and mountain biking.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D36",
    "name": "Jackson Hole",
    "templateSlug": "ski-trips",
    "query": "jackson hole ski trip",
    "coverPath": "/brand/destinations/jackson-hole.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "whistler",
    "region": "Western Canada",
    "base": "Compare the Village, Upper Village and Creekside using the group's intended activities. Confirm where the shared dinner will be, even when people stay in different buildings.",
    "arrivals": "Collect flight and onward-transfer details separately. Agree on equipment capacity and the actual drop-off address before treating a shared transfer as settled.",
    "shared": [
      "An evening meal that brings skiers and non-skiers back together",
      "Keep passes, equipment and optional activities outside the common house split"
    ],
    "optional": [
      "A Valley Trail outing or separate village afternoon"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · An evening meal that brings skiers and non-skiers back together",
      "Room to choose · A Valley Trail outing or separate village afternoon",
      "Before leaving · Keep passes, equipment and optional activities outside the common house split"
    ],
    "coordinationQuestion": "How do we organize a Whistler group trip with different transfer times, ski plans and accommodation?",
    "intro": "Compare the Village, Upper Village and Creekside using the group's intended activities. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Tourism Whistler transit",
        "url": "https://www.whistler.com/getting-around/transit/",
        "fact": "BC Transit connects Whistler Village, Creekside and other neighborhoods.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Tourism Whistler transit",
        "url": "https://www.whistler.com/getting-around/transit/",
        "fact": "Seasonal shuttle services serve destinations including Lost Lake Park and Marketplace.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D37",
    "name": "Whistler",
    "templateSlug": "ski-trips",
    "query": "whistler ski trip",
    "coverPath": "/brand/destinations/whistler.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "banff",
    "region": "Western Canada",
    "base": "Choose a Banff or Lake Louise base deliberately and compare it with the outings the group wants. Avoid a plan that depends on finding parking at every attraction.",
    "arrivals": "Collect arrival details and planned onward transport. Review seasonal shuttle reservations and park requirements before adding a lake excursion to the shared schedule.",
    "shared": [
      "A group dinner and one clearly agreed outing",
      "Keep park access, transport and optional tours recorded as separate costs"
    ],
    "optional": [
      "An additional lake or mountain visit for a smaller group"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A group dinner and one clearly agreed outing",
      "Room to choose · An additional lake or mountain visit for a smaller group",
      "Before leaving · Keep park access, transport and optional tours recorded as separate costs"
    ],
    "coordinationQuestion": "How do we coordinate a Banff group trip around separately reserved shuttles and optional lake outings?",
    "intro": "Choose a Banff or Lake Louise base deliberately and compare it with the outings the group wants. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Banff and Lake Louise transit and shuttles",
        "url": "https://www.banfflakelouise.com/explore-the-park/transit-shuttles",
        "fact": "Transit and shuttle options serve attractions including Lake Louise, Moraine Lake and Johnston Canyon.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Banff and Lake Louise transit and shuttles",
        "url": "https://www.banfflakelouise.com/explore-the-park/transit-shuttles",
        "fact": "The official guide warns that parking at popular attractions is limited or unavailable.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D38",
    "name": "Banff",
    "templateSlug": "friends-trips",
    "query": "banff group trip",
    "coverPath": "/brand/destinations/banff.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "maui",
    "region": "Hawaii",
    "base": "Choose one region for the stay before collecting hotel links. Compare the group's beach, town and driving preferences rather than trying to stay near every part of the island.",
    "arrivals": "Collect each flight and the actual arrival airport, then review vehicle capacity by household. Keep the first evening light for people arriving at different times.",
    "shared": [
      "A shared meal near the stay and a relaxed day together",
      "Agree on shared vehicles and groceries without charging every excursion to everyone"
    ],
    "optional": [
      "An independently reviewed outing to another region"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared meal near the stay and a relaxed day together",
      "Room to choose · An independently reviewed outing to another region",
      "Before leaving · Agree on shared vehicles and groceries without charging every excursion to everyone"
    ],
    "coordinationQuestion": "How do we organize a Maui family trip with one shared base, different flights and optional day trips?",
    "intro": "Choose one region for the stay before collecting hotel links. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Go Hawaii Maui maps",
        "url": "https://www.gohawaii.com/islands/maui/travel-info/maps",
        "fact": "Maui is divided into West, South, Central, Upcountry and East regions.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Go Hawaii Maui maps",
        "url": "https://www.gohawaii.com/islands/maui/travel-info/maps",
        "fact": "Most resorts are in West Maui and South Maui.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D39",
    "name": "Maui",
    "templateSlug": "family-vacations",
    "query": "maui family vacation",
    "coverPath": "/brand/destinations/maui.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "oahu",
    "region": "Hawaii",
    "base": "Decide whether the trip is centered on Honolulu and Waikīkī or another region. A group base should match the everyday plan, not only one day-trip idea.",
    "arrivals": "Gather actual flight arrivals and accommodation addresses. Agree who wants a shared transfer and keep others' independent arrival plans visible.",
    "shared": [
      "A welcome meal and one shared coastal day",
      "Separate vehicle and outing costs by participants, not by the full invitation list"
    ],
    "optional": [
      "A separately reviewed North Shore or Windward Coast outing"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A welcome meal and one shared coastal day",
      "Room to choose · A separately reviewed North Shore or Windward Coast outing",
      "Before leaving · Separate vehicle and outing costs by participants, not by the full invitation list"
    ],
    "coordinationQuestion": "How do we coordinate an Oahu group vacation without making every coastal outing a whole-group expense?",
    "intro": "Decide whether the trip is centered on Honolulu and Waikīkī or another region. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Go Hawaii Oahu regions",
        "url": "https://www.gohawaii.com/islands/oahu/regions",
        "fact": "Oʻahu's five regions are Honolulu, the Windward Coast, Central Oʻahu, the Leeward Coast and the North Shore.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Go Hawaii Oahu regions",
        "url": "https://www.gohawaii.com/islands/oahu/regions",
        "fact": "Waikīkī is part of the Honolulu visitor area.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D40",
    "name": "Oahu",
    "templateSlug": "family-vacations",
    "query": "oahu family vacation",
    "coverPath": "/brand/destinations/oahu.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "cabo-san-lucas",
    "region": "Mexico and Caribbean",
    "base": "Distinguish Cabo San Lucas from San José del Cabo and corridor properties before comparing stays. Use the precise hotel or house address for shared rides.",
    "arrivals": "Collect flight details and transfer arrangements by party. Confirm vehicle capacity and the actual drop-off with the provider before sharing a pickup plan.",
    "shared": [
      "A dinner together at the agreed base",
      "Keep optional excursions distinct from shared lodging and transfers"
    ],
    "optional": [
      "A separately booked boat or town outing"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A dinner together at the agreed base",
      "Room to choose · A separately booked boat or town outing",
      "Before leaving · Keep optional excursions distinct from shared lodging and transfers"
    ],
    "coordinationQuestion": "How do we organize a Cabo group trip when people book different hotels and airport transfers?",
    "intro": "Distinguish Cabo San Lucas from San José del Cabo and corridor properties before comparing stays. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Los Cabos Tourism maps",
        "url": "https://www.visitloscabos.travel/industry/tools/maps/",
        "fact": "Los Cabos includes the towns of San José del Cabo and Cabo San Lucas.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Los Cabos Tourism maps",
        "url": "https://www.visitloscabos.travel/industry/tools/maps/",
        "fact": "The Tourist Corridor links the two towns.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D41",
    "name": "Cabo San Lucas",
    "templateSlug": "birthday-trips",
    "query": "cabo san lucas group trip",
    "coverPath": "/brand/destinations/cabo-san-lucas.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "cancun",
    "region": "Mexico and Caribbean",
    "base": "Compare a Hotel Zone stay with a downtown base using the activities the group wants to share. Confirm whether different properties allow guests to meet before promising a resort gathering.",
    "arrivals": "Record flight, airport and transfer provider for each party. Share confirmed pickup details privately with the relevant travelers, not a booking code in a public plan.",
    "shared": [
      "A welcome meal with a clear location and guest policy",
      "Keep independently purchased packages separate from common transport"
    ],
    "optional": [
      "An individually booked outing away from the shared stay"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A welcome meal with a clear location and guest policy",
      "Room to choose · An individually booked outing away from the shared stay",
      "Before leaving · Keep independently purchased packages separate from common transport"
    ],
    "coordinationQuestion": "How do we coordinate a Cancun group trip when travelers have their own packages and want a few shared plans?",
    "intro": "Compare a Hotel Zone stay with a downtown base using the activities the group wants to share. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Caribe Mexicano Cancun guide",
        "url": "https://caribemexicano.travel/destinos/cancun",
        "fact": "Cancún's visitor guide distinguishes the Hotel Zone from downtown.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Caribe Mexicano Cancun guide",
        "url": "https://caribemexicano.travel/destinos/cancun",
        "fact": "Nichupté Lagoon is part of the destination's dining and activity landscape.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D42",
    "name": "Cancun",
    "templateSlug": "friends-trips",
    "query": "cancun group trip",
    "coverPath": "/brand/destinations/cancun.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "puerto-vallarta",
    "region": "Mexico and Caribbean",
    "base": "Compare the Romantic Zone, downtown and Marina Vallarta against the shared activities you actually want. Do not assume a marina-area stay is the same as a downtown meeting point.",
    "arrivals": "Gather flight arrivals and precise stay addresses. Confirm shared transfers by party and provide a separate plan for late arrivals.",
    "shared": [
      "A group dinner with individual food needs collected first",
      "Keep optional boat tickets and personal purchases out of shared costs"
    ],
    "optional": [
      "A smaller waterfront or boat outing booked independently"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A group dinner with individual food needs collected first",
      "Room to choose · A smaller waterfront or boat outing booked independently",
      "Before leaving · Keep optional boat tickets and personal purchases out of shared costs"
    ],
    "coordinationQuestion": "How do we organize a Puerto Vallarta trip with separate stays, arrivals and optional boat outings?",
    "intro": "Compare the Romantic Zone, downtown and Marina Vallarta against the shared activities you actually want. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Puerto Vallarta official things to do",
        "url": "https://visitpuertovallarta.com/index.php/things-to-do",
        "fact": "The Romantic Zone is across the Cuale River from downtown.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Puerto Vallarta official things to do",
        "url": "https://visitpuertovallarta.com/index.php/things-to-do",
        "fact": "The official guide covers dining in Marina Vallarta, downtown, the Romantic Zone and Versalles.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D43",
    "name": "Puerto Vallarta",
    "templateSlug": "friends-trips",
    "query": "puerto vallarta group trip",
    "coverPath": "/brand/destinations/puerto-vallarta.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "san-juan",
    "region": "Mexico and Caribbean",
    "base": "Compare an Old San Juan-focused trip with a Condado stay before people book separately. Pick one shared dinner area and review actual addresses for the group.",
    "arrivals": "Collect flights and accommodation details by household. Set one clear first meeting point and allow travelers to handle their own arrival if a shared transfer does not fit.",
    "shared": [
      "A welcome dinner and an agreed Old San Juan visit",
      "Keep personal excursions separate from shared lodging and agreed rides"
    ],
    "optional": [
      "A quieter coastal afternoon for travelers skipping a longer walk"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A welcome dinner and an agreed Old San Juan visit",
      "Room to choose · A quieter coastal afternoon for travelers skipping a longer walk",
      "Before leaving · Keep personal excursions separate from shared lodging and agreed rides"
    ],
    "coordinationQuestion": "How do we coordinate a San Juan group trip between an Old San Juan visit and a Condado base?",
    "intro": "Compare an Old San Juan-focused trip with a Condado stay before people book separately. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Discover Puerto Rico Condado neighborhood",
        "url": "https://www.discoverpuertorico.com/article/exploring-neighborhood-condado",
        "fact": "Condado is a neighborhood in San Juan.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Discover Puerto Rico Condado neighborhood",
        "url": "https://www.discoverpuertorico.com/article/exploring-neighborhood-condado",
        "fact": "Condado has an oceanfront setting with dining and shopping.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D44",
    "name": "San Juan",
    "templateSlug": "friends-trips",
    "query": "san juan puerto rico group trip",
    "coverPath": "/brand/destinations/san-juan.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "lisbon",
    "region": "Europe",
    "base": "Compare Baixa or Chiado with a stay in Belém before anyone books. Agree on the walking pace and stairs the group can manage; a shared neighborhood is more useful than a city-wide hotel shortlist.",
    "arrivals": "Collect each arrival and departure in Lisbon local time, then agree who will meet at the stay and who wants to travel together. Keep the first meal flexible for people arriving on separate flights.",
    "shared": [
      "Choose one welcome dinner everyone can reach.",
      "Review a proposed Belém visit together before committing the whole group."
    ],
    "optional": [
      "A small-group neighborhood walk in Alfama.",
      "A slower café afternoon for people skipping a longer outing."
    ],
    "outline": [
      "Arrival · Meet at the agreed stay and leave dinner timing open until flights are known",
      "Together · A proposed Belém outing, with separate interests afterward",
      "Farewell · Coffee near the stay and independent departures"
    ],
    "coordinationQuestion": "We planned Lisbon in ChatGPT. How do we turn it into a shared trip everyone can respond to?",
    "intro": "Keep the Lisbon ideas you already like. Give the group one place to answer questions, share arrivals and decide which parts to do together.",
    "sources": [
      {
        "title": "Visit Lisboa: historic neighborhoods",
        "url": "https://www.visitlisboa.com/en/p/historic-neighbourhoods",
        "fact": "Baixa, Chiado, Alfama and Belém are distinct Lisbon neighborhoods in the official visitor guide.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Lisboa: Tagus route",
        "url": "https://www.visitlisboa.com/en/lisbon-stories/15-rota-do-tejo/pois",
        "fact": "Alcântara sits along the river between Baixa and Belém.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D45",
    "name": "Lisbon",
    "templateSlug": "friends-trips",
    "query": "lisbon group trip",
    "coverPath": "/brand/destinations/lisbon.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "porto",
    "region": "Europe",
    "base": "Choose a base around the group's preferred meeting area, then review slopes and stairs for the actual property. A riverside view is not a substitute for a workable arrival plan.",
    "arrivals": "Collect arrival station or airport and local time. Agree on one luggage and check-in plan before suggesting a long first-day walk.",
    "shared": [
      "A shared dinner and a relaxed riverside meeting",
      "Keep individual tastings and tours outside shared accommodation costs"
    ],
    "optional": [
      "A separate tasting or neighborhood walk for interested travelers"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared dinner and a relaxed riverside meeting",
      "Room to choose · A separate tasting or neighborhood walk for interested travelers",
      "Before leaving · Keep individual tastings and tours outside shared accommodation costs"
    ],
    "coordinationQuestion": "How do we turn a Porto weekend idea into a shared trip with clear arrivals and optional tastings?",
    "intro": "Choose a base around the group's preferred meeting area, then review slopes and stairs for the actual property. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Porto practical information",
        "url": "https://backoffice.visitporto.travel/en-GB/faq",
        "fact": "Andante is used on public transport within the Porto metropolitan area.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Porto practical information",
        "url": "https://backoffice.visitporto.travel/en-GB/faq",
        "fact": "The official visitor guide describes a riverside and seafront route from Ribeira toward City Park.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D46",
    "name": "Porto",
    "templateSlug": "friends-trips",
    "query": "porto group trip",
    "coverPath": "/brand/destinations/porto.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "barcelona",
    "region": "Europe",
    "base": "Compare the Gothic Quarter and Eixample around your group's pace and evening plans. Check the actual building's access and sleeping arrangements before choosing a shared apartment.",
    "arrivals": "Gather flights or train arrivals and local times. Keep the first meal flexible and record where people can leave luggage before check-in.",
    "shared": [
      "A welcome dinner and one agreed architecture outing",
      "Separate attraction tickets and optional tours from the shared stay"
    ],
    "optional": [
      "Smaller neighborhood walks with a clear place to regroup"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A welcome dinner and one agreed architecture outing",
      "Room to choose · Smaller neighborhood walks with a clear place to regroup",
      "Before leaving · Separate attraction tickets and optional tours from the shared stay"
    ],
    "coordinationQuestion": "How do we organize a Barcelona friends trip with separate flights and different sightseeing interests?",
    "intro": "Compare the Gothic Quarter and Eixample around your group's pace and evening plans. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Barcelona Tourism Quadrat d'Or",
        "url": "https://bid.barcelonaturisme.com/wv3/en/page/167/quadrat-d-or.html",
        "fact": "The Quadrat d'Or is an area of the Eixample around Passeig de Gràcia.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Barcelona Tourism Quadrat d'Or",
        "url": "https://bid.barcelonaturisme.com/wv3/en/page/167/quadrat-d-or.html",
        "fact": "The district features modernista architecture with decorative façades and stained glass.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D47",
    "name": "Barcelona",
    "templateSlug": "friends-trips",
    "query": "barcelona group trip",
    "coverPath": "/brand/destinations/barcelona.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "rome",
    "region": "Europe",
    "base": "Choose a shared meeting neighborhood before comparing stays across the city. Ask about stairs and walking pace, and keep a realistic amount of time unplanned.",
    "arrivals": "Collect airport or station and the actual arrival time. Agree who will meet at the stay rather than making all travelers wait for one transfer.",
    "shared": [
      "A shared dinner and one reviewed sightseeing anchor",
      "Keep individually booked admissions separate from common meals and lodging"
    ],
    "optional": [
      "A Trastevere walk for a smaller group"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A shared dinner and one reviewed sightseeing anchor",
      "Room to choose · A Trastevere walk for a smaller group",
      "Before leaving · Keep individually booked admissions separate from common meals and lodging"
    ],
    "coordinationQuestion": "How do we coordinate a Rome group trip with different arrival points, walking paces and attraction tickets?",
    "intro": "Choose a shared meeting neighborhood before comparing stays across the city. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Turismo Roma Porta Portese and Trastevere",
        "url": "https://www.turismoroma.it/en/places/porta-portese-market",
        "fact": "Trastevere includes the Basilica of Santa Cecilia and the Museum of Roma in Trastevere.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Turismo Roma Porta Portese and Trastevere",
        "url": "https://www.turismoroma.it/en/places/porta-portese-market",
        "fact": "Gianicolo Hill is a viewpoint above the neighborhood.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D48",
    "name": "Rome",
    "templateSlug": "friends-trips",
    "query": "rome group trip",
    "coverPath": "/brand/destinations/rome.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "edinburgh",
    "region": "Europe",
    "base": "Compare Old Town and New Town around the group's plans. Review the property's stairs and the routes people would walk; being central does not guarantee a flat approach.",
    "arrivals": "Collect air and rail arrivals separately and keep local times clear. Agree on a luggage plan before a first-day walk and a named meeting point for dinner.",
    "shared": [
      "A welcome dinner and a short shared city walk",
      "Keep admission tickets and optional tours tied to their actual participants"
    ],
    "optional": [
      "An independently booked museum or castle visit"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A welcome dinner and a short shared city walk",
      "Room to choose · An independently booked museum or castle visit",
      "Before leaving · Keep admission tickets and optional tours tied to their actual participants"
    ],
    "coordinationQuestion": "How do we organize an Edinburgh group visit around a shared dinner and different sightseeing plans?",
    "intro": "Compare Old Town and New Town around the group's plans. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Forever Edinburgh access guide",
        "url": "https://edinburgh.org/planning/getting-around/disabled-access/",
        "fact": "Old Town has cobbled and uneven streets.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Forever Edinburgh access guide",
        "url": "https://edinburgh.org/planning/getting-around/disabled-access/",
        "fact": "The official access guide provides information about accessibility features in the Bus and Tram app.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D49",
    "name": "Edinburgh",
    "templateSlug": "golf-trips",
    "query": "edinburgh golf trip",
    "coverPath": "/brand/destinations/edinburgh.webp",
    "artStatus": "reviewed"
  },
  {
    "slug": "dublin",
    "region": "Europe",
    "base": "Choose a city meeting base first, then decide whether a coastal excursion belongs in the shared plan. Compare actual lodging addresses instead of assuming every city-center stay is nearby.",
    "arrivals": "Collect airport, rail or ferry arrival points and times. Let people travel independently when a common pickup would create unnecessary waiting.",
    "shared": [
      "A group dinner and an easy city-center meeting",
      "Keep independent tickets and optional excursions separate from common meals"
    ],
    "optional": [
      "A coastal outing with a separate headcount and return plan"
    ],
    "outline": [
      "Arrival · Settle into the agreed stay and keep the first gathering flexible",
      "Together · A group dinner and an easy city-center meeting",
      "Room to choose · A coastal outing with a separate headcount and return plan",
      "Before leaving · Keep independent tickets and optional excursions separate from common meals"
    ],
    "coordinationQuestion": "How do we coordinate a Dublin group trip with separate arrivals and an optional coastal day?",
    "intro": "Choose a city meeting base first, then decide whether a coastal excursion belongs in the shared plan. Use the shared trip to collect answers, record the arrangements people make elsewhere and keep a few plans everyone can join.",
    "sources": [
      {
        "title": "Visit Dublin first-time guide",
        "url": "https://www.visitdublin.com/guides/guide-first-time-Visitor-dublin",
        "fact": "DART trains connect Dublin city center with coastal destinations.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      },
      {
        "title": "Visit Dublin first-time guide",
        "url": "https://www.visitdublin.com/guides/guide-first-time-Visitor-dublin",
        "fact": "Dublin's public transport includes bus, tram and rail services.",
        "checkedAt": "2026-11-03",
        "evidenceType": "page"
      }
    ],
    "id": "D50",
    "name": "Dublin",
    "templateSlug": "friends-trips",
    "query": "dublin group trip",
    "coverPath": "/brand/destinations/dublin.webp",
    "artStatus": "reviewed"
  }
];
export function getDestination(slug: string | undefined): DestinationDefinition | undefined {
  return destinationCatalog.find(destination => destination.slug === slug);
}
