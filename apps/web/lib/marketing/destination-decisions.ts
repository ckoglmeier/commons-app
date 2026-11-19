import type { DestinationSource } from './destinations';
type Decisions={intro:string;baseChoice:string;arrivalsQuestion:string;agreeFirst:string;costExample:string;question:string;extraSources?:DestinationSource[]};
/** Editorial coordination examples. Travel facts are linked in the destination's source list. */
export const destinationDecisions:Record<string,Decisions>={
 lisbon:{
 intro:'A dinner everyone can reach, a few ideas worth sharing and room for different interests. Turn your Lisbon conversation into a trip the group can help shape.',
 baseChoice:'Shortlist actual stays in Baixa or Chiado and in Belém. For each, compare the route to your welcome dinner, sleeping arrangements and any stairs the host confirms. Let the group choose the tradeoff before someone pays a deposit.',
 arrivalsQuestion:'Ask for the local arrival date, flight time and the address each person needs to reach. A morning landing and an evening landing need separate welcome plans; neither should decide the whole group’s first day.',
 agreeFirst:'Pick one shared dinner and ask who wants the proposed Belém outing. Leave an Alfama walk optional, with a clear meeting point for people rejoining later.',
 costExample:'Illustrative split: everyone staying in the shared apartment contributes under the agreed room/night rule. Only those taking an optional outing share its cost; independent flights stay personal.',
 question:'Would you rather stay near our proposed dinner in Baixa or Chiado, or make Belém our base? Tell us about any walking or stair needs before we choose.'},
 asheville:{
 intro:'Bring several households together without making every arrival, bed and outing the same. Start your Asheville reunion with the decisions that affect the whole family.',
 baseChoice:'Compare a shared house with separate rooms in town. Ask the host about bedrooms, bathrooms and entry access; ask the family which meals they want together. A house only helps if its layout fits the people coming.',
 arrivalsQuestion:'Collect each household’s arrival window, vehicle seats and check-in needs. Put late arrivals in touch with the person holding the keys instead of delaying everyone’s dinner.',
 agreeFirst:'Choose the reunion meal first. Offer the River Arts District and a greenway outing as separate interests, and check current openings and route conditions before assigning a time.',
 costExample:'Illustrative split: three households share the house by the rule they agree before booking. Relatives sleeping elsewhere can join the meal without being included in the accommodation charge.',
 question:'Who needs a bedroom in the shared house, who is staying separately, and which meal can your household join?'},
 scottsdale:{
 intro:'Eight friends, separate flights and different ideas about how much golf to play. Give your Scottsdale group a shared plan without requiring everyone to join every round.',
 baseChoice:'Use the official golf-course chart to compare proposed rounds with the exact house address. Put time near the courses and evenings in Old Town on the same shortlist; confirm the beds and cars before choosing.',
 arrivalsQuestion:'Record landing times and golf-bag space, then ask which travelers actually want to share a ride. Keep the first round separate from arrival day until those travelers confirm their schedule.',
 agreeFirst:'Ask for a headcount for each round, not one yes/no for the weekend. Confirm the course’s current booking and cancellation terms with the people participating before a deposit is paid.',
 costExample:'Illustrative split: eight friends share the house, six play one round and four play another. Record each golf expense with its own participants instead of dividing every charge by eight.',
 question:'Which rounds do you want to play, and would you prefer a house closer to those courses or our planned evenings in Old Town?'},
 gatlinburg:{
 intro:'Give a church or community retreat a clear gathering plan, thoughtful room arrangements and space for people to opt into outings.',
 baseChoice:'Compare a cabin’s actual gathering room, beds, entry steps and parking with the group’s needs. Treat a downtown visit as a separate transport decision; a cabin address does not establish access to a trolley stop.',
 arrivalsQuestion:'Collect household arrival windows and confirmed drivers with available seats. For a downtown outing, use the published trolley map and review the Welcome Center Park-n-Ride option rather than assuming a cabin pickup.',
 agreeFirst:'Confirm who joins the retreat meal and main session before choosing optional outings. Keep your organization’s accessibility, safeguarding and financial approvals in its established process.',
 costExample:'Illustrative split: record the retreat house and common meal under the organization’s agreed policy. A day visitor who joins only the meal should not automatically receive a share of the overnight stay.',
 question:'Who is staying overnight, who is joining for the day, and what room or access needs should we account for before choosing the house?'},
 'new-york':{
 intro:'Different airports, hotels and show tickets can still become one New York trip. Agree where you will meet, then let people make the arrangements that suit them.',
 baseChoice:'Start with the address of the main event or shared dinner. Compare each proposed stay’s route to that meeting point, including transfers and walking needs, before comparing room prices alone.',
 arrivalsQuestion:'Collect the airport code and local arrival time for each person. JFK, LaGuardia and Newark are different arrival points; choose separate routes to the stay rather than treating them as one airport pickup.',
 agreeFirst:'Choose the dinner headcount and exact pre-show meeting location. Let people buy different shows or skip one, with a clear plan for rejoining afterward.',
 costExample:'Illustrative split: six friends share dinner, four book the same show and two choose a museum. Dinner can be shared across six; show tickets and museum admissions belong only to the people attending.',
 question:'Where are you arriving, where are you staying, and which shared dinner or show would you like to join?',
 extraSources:[{title:'JFK Airport: transfers between airports',url:'https://www.jfkairport.com/flights/connections-guide/travel-between-airports',fact:'The airport operator describes separate transfers between JFK, LaGuardia and Newark, with additional time needed between airports.',checkedAt:'2026-11-03',evidenceType:'page'}]},
 rome:{
 intro:'A few shared meals and one agreed sightseeing anchor can give your Rome trip shape without making everyone keep the same pace.',
 baseChoice:'Compare a stay near your proposed evening gathering with one near your arrival connection. Review the exact walking routes and ask the property about stairs and lifts; a neighborhood name alone does not answer access needs.',
 arrivalsQuestion:'Ask whether each flight arrives at Fiumicino or Ciampino. Trenitalia lists a direct Leonardo express rail connection from Fiumicino to Roma Termini, while Ciampino Airlink combines bus and train. Review each traveler’s onward route separately.',
 agreeFirst:'Choose one attraction the group wants together and check its current admission arrangements before setting the rest of the day. Keep a Trastevere walk optional for anyone who wants a slower afternoon.',
 costExample:'Illustrative split: share the apartment under the agreed room/night rule and a dinner with those attending. Keep individually booked attraction tickets and separate airport transfers out of the common accommodation split.',
 question:'Which airport are you arriving at, what walking pace suits you, and which one visit would you most like us to do together?',
 extraSources:[{title:'Trenitalia: Leonardo express',url:'https://www.trenitalia.com/en/services/leonardo-express.html',fact:'Leonardo express connects Rome Fiumicino Airport directly with Roma Termini.',checkedAt:'2026-11-03',evidenceType:'page'},{title:'Trenitalia: Ciampino Airlink',url:'https://www.trenitalia.com/en/connections/ciampino-airlink.html',fact:'Ciampino Airlink combines a bus connection to Ciampino station with train travel to Roma Termini.',checkedAt:'2026-11-03',evidenceType:'page'}]},
 'san-diego':{
 intro:'Different ages, arrival times and energy levels belong in the same family vacation. Give your San Diego group a few dependable meeting points and flexible days.',
 baseChoice:'Compare the proposed stay with your main family gathering and the outings people actually want. Balboa Park is north of downtown; check the full route from each candidate stay rather than treating all San Diego addresses as equivalent.',
 arrivalsQuestion:'Collect who has a car, who needs a ride and any child-seat requirements. Ask travelers arriving late to join at the stay or a later meal instead of making the first outing depend on every flight.',
 agreeFirst:'Choose the specific museums each household wants before buying admission. Balboa Park museums operate independently, so verify their current hours and ticket arrangements individually.',
 costExample:'Illustrative split: share groceries with the households using them. Include only the relevant travelers on museum tickets or a separate outing; agree how children count before dividing a shared meal.',
 question:'Which outings matter most to your household, who needs a ride, and when should we leave time for a break?'},
 sedona:{
 intro:'Build a retreat around the time you want together, with outdoor plans people can choose according to their interests and needs.',
 baseChoice:'Compare actual stays by the room for shared sessions, sleeping arrangements and access requirements. A view is a welcome extra; it does not establish whether the gathering space works for your retreat.',
 arrivalsQuestion:'Ask which travelers have vehicles and who wants to share an arrival ride. For a trail outing, check Sedona Shuttle’s current route and schedule separately from airport travel.',
 agreeFirst:'Choose the main retreat session and meal first. Let each traveler opt into a trail outing after reviewing the route and current conditions; provide an equally clear plan for those staying back.',
 costExample:'Illustrative split: shared accommodation and the retreat meal follow the agreed group policy. An optional guide or outing is allocated only to those joining; no one is assumed to join a hike because they joined the trip.',
 question:'What would make the retreat worthwhile for you, and would you prefer an optional trail outing or a quieter afternoon?',
 extraSources:[{title:'Visit Sedona: arts and culture',url:'https://visitsedona.com/arts-culture/',fact:'Gallery clusters in Uptown, West Sedona and along State Route 179 give art lovers an alternative to a trail outing.',checkedAt:'2026-11-06',evidenceType:'page'},{title:'Visit Sedona: Tlaquepaque Arts & Shopping Village',url:'https://visitsedona.com/directory/tlaquepaque-arts-shopping-village-art-galleries/',fact:'Tlaquepaque brings galleries and shops into courtyards beside Oak Creek. Its Mexican-village architecture and shaded setting offer a distinctive place to explore at your own pace.',checkedAt:'2026-11-06',evidenceType:'page'}]},
 'park-city':{
 intro:'A ski weekend can work for different abilities, lesson plans and days off. Agree on the shared stay and meeting points before asking everyone to buy the same ski days.',
 baseChoice:'Compare the exact stay with the resort base and bus stop you expect to use. The visitor guide describes free transit and winter parking requirements; verify the current route or reservation rules for your dates before choosing cars over buses.',
 arrivalsQuestion:'Collect arrival times, luggage and ski-bag needs before arranging a shared airport ride. Confirm a check-in plan for the earliest and latest travelers rather than assigning a driver by default.',
 agreeFirst:'Ask who is skiing on each day, who has a lesson and who wants a day off. Set a dinner meeting point that does not require everyone to finish on the same run.',
 costExample:'Illustrative split: everyone using the house contributes under the stay rule. Lift tickets, lessons and rentals remain individual unless the relevant travelers explicitly agree to a shared purchase.',
 question:'Which days will you ski, are you taking lessons, and would you rather use transit or share a vehicle for the plans we choose?'},
 nashville:{
 intro:'Bring the celebration together around one dinner and the music people actually want to hear. Everyone can join the trip without committing to the same late night.',
 baseChoice:'Compare Midtown hotel options with the exact downtown places on your shortlist. Ask about room sharing and evening preferences; choose the location that fits the group’s plans rather than a generic nightlife checklist.',
 arrivalsQuestion:'Ask for each traveler’s hotel and arrival window. Keep the first music outing optional and give late arrivals a clear dinner or next-morning meeting point.',
 agreeFirst:'Collect a separate headcount for the dinner and any ticketed performance. Confirm current booking terms before paying for people who have only expressed general interest.',
 costExample:'Illustrative split: eight friends join dinner and five buy tickets for a performance. Split the dinner with its actual participants and the tickets with those five; agree separately whether anyone is treating the guest of honor.',
 question:'Which dinner or performance do you want to join, and would you prefer a quieter evening option after we have spent time together?'}
};
