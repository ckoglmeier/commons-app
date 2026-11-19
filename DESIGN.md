# Commons design and interaction contract

This file is the contract for how Commons looks, reads and behaves. Read it before you change a screen, a component, a visual token or any words people see. If a new requirement conflicts with it, change this file in the same pull request and say why. Do not add a one-off exception in a route.

Commons is a web app for groups who plan something together. The production app is `apps/web`. Shared tokens and brand pieces are in `packages/ui`.

## Contents

1. Templates
2. Product rules
3. Character
4. Identity
5. Color
6. Typography
7. Layout and components
8. App structure
9. Trip
10. Plan
11. Polls and open questions
12. To-dos
13. People and invitations
14. Money
15. Photos and covers
16. Messages with Commons
17. Documents
18. Motion and accessibility
19. Implementation and checks

## 1. Templates

Plans start from templates. A template sets the starting questions, polls, plan section names, to-dos and money hints for a new plan. Templates live in `packages/domain/src/plan-templates`. The guide is `docs/writing-a-template.md`.

Trips are the first template. The interface always says "trip", whatever the template. A template changes what a plan starts with. It does not change how Commons works, so a template never adds new permissions, screens or actions.

## 2. Product rules

- Chat is an interface to shared state. It is not the main information architecture. The trip's records are the product; a conversation is one way to read and change them.
- Keep people distinct. A human participant, Commons and any future personal agent must never look alike or share a name, avatar or voice.
- Do not imply things the app cannot do. No booking, no payments moving through Commons, no access to external calendars, no automatic changes to the plan, no agent authority beyond what the current release supports.
- A consequential change needs three visible things: where it came from (provenance), exactly what it touches (scope) and a human who approved it. This covers anything that changes the shared plan, sends something to the group or records money.
- Suggestions are labelled as suggestions. A suggested place is not a confirmed place. A poll answer is an input; the organizer decides.
- Private details stay private on the server. Filter them before data reaches the client. Never hide a private field with CSS or by hiding a control.
- Say what is true. Unknown values read **Still open** or **Nothing saved yet**. Success is shown only after the save is confirmed. Never show a progress claim, feed or count that was not read from saved records.
- Saving, sharing, publishing and sending are separate actions. One never implies another.

## 3. Character

Calm, prepared, adult and travel-oriented. Clean sans-serif type, generous white space, forest green and a small amount of coral. Artistic, not cartoonish. Warmth comes from proportion, illustration, real group content and useful words.

Do not use cute mascot faces, bubbly lettering, serif display type, decorative AI chrome, gradients on controls, endless motion or generic dashboard tiles. The app should not look like an airline booking portal or a luxury resort.

Voice: plain, short sentences. Say what happened and what to do next. No hype, no jokes at someone's expense, no blame. Use "trip", "group", "organizer" and "traveler" consistently.

## 4. Identity

The mark is **bird A**: two tapered, gestural strokes that suggest flight. It is not a literal swallow, a line drawing of a bird or a wing attached to a letter.

- Horizontal lockup: the bird followed by the full word **Commons**.
- Stacked lockup: a smaller bird above the wordmark, for roomy brand uses only.
- Standalone bird: app icon, favicon and compact identification.
- Wordmark: Geist Sans, regular or medium (450 to 500), ordinary letterforms. Do not alter the C, m or s.
- Forest green on white, or white on forest. No multicolor bird and no coral logo.
- Leave clear space of at least one quarter of the mark's height. Do not stretch, rotate, crop or add shadows.
- Small artwork must keep the two-stroke shape at 16, 24, 32 and 48px. Use an optically simplified bird if needed.
- Brand links announce "Commons". Decorative SVGs are hidden from assistive technology.
- One reusable SVG source drives production use (`packages/ui/src/mark.tsx`). Raster boards are not final assets.

## 5. Color

| Role | Token | Value |
|---|---|---|
| Primary text, primary action, inverse background | `--cm-color-ink` | `#16372F` |
| Brand, links, selected state | `--cm-color-green` | `#2E6758` |
| Canvas and paper | `--cm-color-canvas`, `--cm-color-paper` | `#FFFFFF` |
| Warm board | `--cm-color-board` | `#F7F6F2` |
| Secondary text | `--cm-color-mineral` | `#5E6C67` |
| Dividers | `--cm-color-line` | `#DCE4E0` |
| Decorative emphasis | `--cm-color-coral` | `#E8A099` |
| Gentle emphasis background | `--cm-color-coral-wash` | `#FAECE9` |
| Shared or selected background | `--cm-color-green-wash` | `#E4ECE8` |
| Error, attention, focus | `--cm-color-ember` | `#A64132` |
| Attention background | `--cm-color-ember-wash` | `#F4E4DF` |

Green and white dominate. Coral is about 5% or less of a typical view: a small underline, a status tag or a quiet emphasis background. No yellow accent.

Coral is not the warning color. Keep attention and focus (ember) separate from decoration (coral). Use forest text on coral, never white body text.

Contrast: normal text needs 4.5:1. Large text and the boundaries of controls need 3:1. Do not rely on the pale divider token as the only edge of an input.

Prefer the semantic tokens (`--cm-color-text`, `--cm-color-text-secondary`, `--cm-color-action`, `--cm-color-focus`, `--cm-color-attention`, `--cm-color-shared-surface` and the others in `tokens.css`) to the raw palette. Do not add raw color values in route CSS.

Working panels (status, forms, notes, confirmations) use one quiet style: a rule and a board wash (`--cm-panel-*`). Ember marks something that needs a person. Green marks something finished. Never add a second border or nest a card in a card.

The persistent rail is a dark band (`--cm-shell-rail-*`) so navigation reads apart from the work beside it. Text on it is light and the active row is a lighter wash.

## 6. Typography

Use **Geist Sans** for everything. Geist Mono is for codes only. Use tabular numerals for times and money.

- Display: weight 400 to 500, tracking -0.035em to -0.02em, line height 1.05 to 1.15.
- Page title: 32 to 44px, weight 500.
- Section heading: 22 to 28px, weight 500.
- Document title: 20px (`--cm-text-document-title`). Document section heading: 17px (`--cm-text-document-section`). These compact roles do not use the display or page-title scale.
- Body: 15 to 18px, weight 400 to 450, line height 1.5 to 1.65.
- Controls: 14 to 16px, weight 550 to 600.
- Metadata: 12 to 14px. Do not use low contrast to make hierarchy.
- Inputs: at least 16px on mobile.
- Times use 12-hour AM/PM in the interface. Storage stays as local `HH:mm` or UTC instants.
- Email falls back to Arial or Helvetica throughout.

Avoid bold everywhere. Long trip names, places and dates must stay readable at large text sizes. Wrap them; never clip them.

When space is tight, reduce grouping and padding before you reduce text size. Keep body text at 15 to 16px, buttons at 14px and targets at 44px.

## 7. Layout and components

Use the 4px spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80 (`--cm-space-*`). Mobile gutters are 16 to 20px.

**Build mobile first.** Check every change at 390px and 430px, then tablet and desktop. Also check 200% zoom and short heights, such as a phone in landscape. Do not squeeze desktop columns into horizontal scrolling.

Prefer rules and white space to nested cards.

| Part | Rule |
|---|---|
| Primary button | Forest fill, white label, 44px minimum target, 10 to 16px corner radius. One filled button at a time in a region. |
| Secondary button | White, forest text, a border with enough contrast. |
| Link | Green with an underline or another clear mark. 44px target. |
| Focus | A 3px ember ring with a 2px offset. Always visible. |
| Sheet | A bounded decision with a clear title and a close action. Up to 28px top radius on mobile. |
| Elevation | Only for layers that float: `0 14px 36px rgb(22 55 47 / 12%)`. |
| Disclosure | Native `details` or a real button. Closed content that holds edits stays mounted. |

Loading, empty, error, success, disabled and pending states are explicit and honest. Use real buttons and links. Status never relies on color alone.

Dialogs: use the native dialog for bounded decisions. Escape closes it and focus returns to the control that opened it. When one sheet hands off to another, release the first before opening the second. Keep unsaved edits when a sheet is closed and reopened.

Photos on cards: keep the photo area unshaded above its caption. Use `--cm-color-photo-caption` only behind text, with a short fade. Never put a full-card wash over a photo.

## 8. App structure

One shell holds every trip page. It has one navigation hierarchy.

- **Desktop (1100px and wider):** a persistent left rail with the Commons mark, the trip identity, the destinations and the personal account control at the foot. Do not repeat the destinations in header tabs or a bottom bar.
- **Below 1100px:** a compact header with the trip identity and a labeled **Menu** button. Menu opens a bounded native dialog with the same destinations, a mark for the current page, Escape to close and focus restored to the button.
- **Destinations:** **Trip**, **Plan**, **Money** and **Photos**. The selected one is always marked in text and shape.
- **Account:** the account control stays personal. Trip settings stay with the trip identity.
- **Trip identity:** cover, trip name, dates and place, the travelers control and settings. Below 1100px the whole identity header is one keyboard-reachable button that opens Trip settings. Organizers see the settings form; travelers see a read-only explanation. Do not add a second details button.
- **Content width:** pages use the shared page container and document width tokens. Content takes the room it needs; do not add a fourth column or an empty side panel.
- **Mounted state:** moving between destinations keeps unsent text, open edits, scroll position and focus where it makes sense. Late results belong to the page that asked for them and do not change selection.
- **Old links:** `section=` links and earlier route names keep working and land on the closest current page.

The Trip, Plan, Money and Photos pages share the same reading style: a warm board behind one white paper, quiet edges, compact headings and rules between rows.

## 9. Trip

Trip is the home of a trip. It is read as a letter.

**The trip letter.** One white paper on the warm board, in the shared document style. It has a dateline that says when saved content last changed, the trip name, the organizer's welcome, a short ruled list of facts (when, where, staying, first up), a permitted group photo and **Latest**. Every fact comes from saved records. Latest shows only real saved changes and is left out when there are none. On a new trip the organizer sees "Only you can see this page" until someone else has access.

**Audience.** Travelers see the same letter through a permission-filtered view. They see only their own next steps and no organizer tools. Private notes, codes, source documents and drafts never appear.

**Stages.** A trip moves through two stages.

- **Getting to going.** The organizer is still deciding. Trip shows one paper of big questions: **where**, **when** and **who's in**. Each open question offers **Add** for an organizer who already knows, then **Ask your group** as the secondary action. One button is filled at a time: **Add** on the next question nobody has started, then **We're going** once every question is moving. Poll answers never settle a question. The organizer decides. "Who's in" is the organizer's note, not attendance.
- **We're going.** The organizer has said so. Money and Photos are fully open and Trip carries the letter, next steps and tools.

Stage is presentation, not a permission. In the first stage the rail still shows Trip, Plan, Money and Photos. Money, Photos, Travel & stays, the map and adding bookings are marked, and each opens a page that says what it does and how to get there. Plan stays open for ideas, with a clear call to action.

A trip can be set to use this stage flow in Trip settings (**New experience**). Trips with it off keep their earlier presentation.

**A name is enough to start.** Creating a trip goes from its name straight to the trip. Setup, People and Review appear only when a copied trip needs its people reviewed, or when something unusual needs confirming as a trip.

**Next steps.** A permission-scoped list of what this person can do now, shown beside or above the letter (**Needs you**). On 390px and 430px it comes first, then the paper at full width, then tools. It has one primary action. While the first invitation is the next step, that is the only filled button. Quiet rows hold other tools.

**Add menu.** The Add menu in the Trip header lists Activity, Meal, Flight, Transport and Lodging, in that order, with Photos and Receipts. It uses the same forms and permissions as the rest of the app. Do not repeat these Add actions in side tools.

**Plan your own trip.** A signed-in person who answered a poll, or who organizes no trip, sees a quiet **Plan your own trip** link. It opens ordinary trip creation. Nothing from the current trip is copied.

## 10. Plan

Plan has two sections in its content header: **Activities** and **Travel & stays**. Put the page heading and actions before the section links. A **Map** action sits beside the sections and is not a third section.

**Activities.**
- One collection holds tentative, undated, day-only and timed activities.
- A day filter narrows the list. **No day yet** keeps undated items. Items outside the trip dates stay under **Outside trip dates**. Shortening a trip never deletes or moves records.
- Scheduling and confirmation are separate. A day does not mean a time, and a time does not mean a booking. Never invent a time for a day-only item.
- Rows show a day heading, a time column and a compact row per item with a native caret for details. Missing times read **Time open**.
- Meals use the same form with a **Restaurant** or **Meal at home** choice. At-home meals have no location field. Restaurant meals may carry a private confirmation number and notes, visible only to the person who saved them.
- Activity cost estimates can become an expense with **Convert to expense**, which opens the expense form to review. See Money.
- Attendance questions appear only for items open to **Whoever wants to join**. Everyone, Just me and Specific people already say who is included.

**Travel & stays**, in this order:
1. **Where we're staying.** Planned and confirmed stays.
2. **Options we're considering.** Each option shows nights, price as entered, address, straight-line distance to placed activities (labelled as not drive time) and an organizer note. Price can be for the whole stay or per room for all nights, with a **Rooms** count. A group total is saved only when rooms are known.
3. **Getting there and home.** Arrivals and departures by day and who is on each. People with nothing shared read **Not shared yet**, which never means unbooked.
4. **Getting around.** Transport and rental-car options with status, vehicle, people, route, price and notes. Price and notes show only to people allowed to see them.

Stay status reads **Considering**, **Planned** or **Confirmed**. Travel arrangements may also be **Tentative**.

Lodging forms start with property, location, dates, included travelers and status. Optional costs, codes, notes and check-in and check-out times sit under **More details**. A timezone is suggested only from a matched location, labelled, and can be changed by hand. Flights show airport, local date, local time and timezone for departure and arrival. Flight basics are always shared with the trip. Costs on flights are not entered or shown; add a separate expense in Money. Confirmation codes, notes and files stay private.

**Quick add.** On a signed-in trip, Activity and Lodging open a one-step add: a link, a name, or a PDF or image that Commons reads for a name and link. An activity saves as an idea with no day or time. A lodging option saves as a stay being considered. **Add details** opens the full editor.

**Map.** The map shows the trip's own activities and stays, with stays being considered. Stays are lettered squares and activities are numbered circles. An approximate area is dashed. A pin is saved only by a person: from a map link, from a page's published coordinates, or by choosing a point on the map with **Save location**. There are no latitude and longitude fields and no address lookup. Places closer than a marker's width share one marker. Day and type filters narrow the map and list together. Nothing is booked, priced or routed. **Directions** hands two exact places to an outside maps app.

**Starting a poll from Plan.** With two or more options, organizers can choose **Include in a poll** and then **Ask the group about these (N)**, or **Ask which place to stay (N)** for stays and **Ask how we get around (N)** for transport. Each opens a private poll draft with those options. Choosing never schedules, saves or shares anything. When an organizer approves a poll result that names a considered stay, **Next steps** offers **Make [place] our stay**, which opens that stay's editor with status set to Planned. Nothing changes until **Save stay**.

## 11. Polls and open questions

A poll asks the group one decision or one piece of feedback. It begins as a readable message with questions added where specific answers help.

**Organizer.**
- **Ask the group** opens the poll editor with a private draft. Nothing is shared until **Share with the group**.
- Sharing is an explicit choice of who can answer: **Trip invitees · Sign-in required**, or **Anyone with the link · No sign-in**. A link poll takes a self-reported name and gives no trip membership.
- Sharing makes the poll available. It does not email anyone. After sharing, offer **Copy link**, **Copy for email** and **Copy for text**. Copying never claims delivery.
- After a poll is shared, replace the editor with a published receipt and a real **Open poll** link. Do not offer Publish again for that command. A failed or uncertain request keeps its retry identity.
- **Revise poll** warns first. It closes the old poll, keeps its answers as history and starts a new draft with no carried votes.
- Closing a poll is not deciding. When answers do not settle the question, say so, and offer two next steps: an organizer decision recorded with its reasons, or a revised round. Silence is never counted as agreement.
- **Help me write this** can draft an introduction, questions and answer choices from a plain description. It uses permitted saved trip facts. Its output is labelled **Commons suggestion · Review before using**. It never publishes, messages anyone or changes the plan. If it is unavailable, manual editing is complete.
- A poll can carry a short introduction that bridges earlier decisions to the current ask. A delivery note for a channel is separate and never shown on the poll page.

**Participant.**
- A poll page opens with the title and introduction. A trip cover is a small, unshaded thumbnail.
- Choices are compact rows with a visible selected wash and keyboard focus.
- Ordinary polls use one column and a single **Anything else? (optional)** field after the questions.
- Ranking has a non-drag control and no default vote. Point allocation shows the remaining budget and rejects a bad total. Interest, availability, preference, abstaining and no answer are different things.
- Review, edit and receipt states keep their meaning for closed and replaced polls.
- Signed-in respondents use verified identity. Guests enter a name.

**Open questions.** Trip's big questions (where, when, who) and each poll's result link to their saved records. Do not build a second question system, and do not resolve a question automatically.

## 12. To-dos

A to-do is a simple action with a title, a named owner and an open or done state.

- Active travelers can create and edit their own. Organizers can assign to other active or invited travelers. Invited assignees do not gain access until they accept.
- Due dates and links to trip items are optional, under **More details**.
- Creating or finishing a to-do never creates or confirms a trip fact. Finishing "book the van" does not book anything.
- Suggested to-dos come from saved state only: unanswered polls, required reviews and missing arrival details. Never infer that travel is unbooked.
- One list feeds Trip, any future messaging and any other view. Finishing a to-do clears it everywhere. Done to-dos leave the active list after a successful save and stay in history. A failed save keeps the item visible.
- Show at most three next steps with a clear way to see the rest.

## 13. People and invitations

People opens from the trip identity. It lists the roster with roles and archive controls.

- **Invite your group:** one inline **Share an invite link** action. Selecting it creates and copies a 14-day link; opening People creates nothing. A short sentence says that anyone who gets the link can sign in and join as a traveler, never as an organizer. If copying fails, show a selectable URL and a true error. Joining needs sign-in and grants no attendance, expense or booking authority. A signed-out preview shows only the trip name, inviter and expiry.
- **Personal invitations:** Traveler is the default role. Organizer is explained before saving and starts only after acceptance with the invited email. **Invite traveler** sends the invitation through the normal delivery path. Organizer invitations are prepared first and sent in a separate step. Show the true state: sent, queued, failed or not sent. Keep the traveler if delivery fails and offer retry. Editing never resends.
- Managed travelers (people without accounts) cannot be organizers and get no invitation email.
- Keep protections for the last organizer and for demoting yourself.
- Attaching an invited person to a plan item shows **Invited · attendance not confirmed**. Attaching never accepts an invitation or records attendance.
- Explicit attendance is the person's own answer. An organizer can record one on someone's behalf only when it is attributed to the organizer.

## 14. Money

Money records what people spent and who owes whom. Commons calculates and records. It does not move funds.

**Order.** Each currency section leads with recorded expenses, the viewer's balance and payments. **Cost forecast** (planned costs and the optional spending target) is a collapsed section beneath them. Before any spending is recorded, Money leads with the expanded forecast and a short empty state for expenses. Payments and wrap-up controls appear only once someone owes something, a payment exists or the ledger is closed.

**Currencies.** The trip currency is set only in Trip settings, with a native dropdown that lists USD first. Money has no currency selector. Saved currencies show as separate sections, with forecasts, expenses, reimbursements and balances calculated apart. Changing the trip currency never converts or relabels saved amounts. Foreign payments never settle balances in another currency. Cost forms show the symbol before the amount.

**Expenses.**
- Entry leads with description, amount, payer and the people who share it. **Advanced** holds optional details and accounting modes.
- Defaults: today in the trip's timezone, and the Other category.
- The form does not ask for a confirmation number. Reservations belong on the meal, lodging or travel record.
- **Convert to expense** on an activity opens this form with the activity's link, currency and remaining estimate filled in. The person reviews the amount and payer before **Record expense**. Cancel records nothing.
- Budget-only estimates are not spending. Tracking-only costs do not split balances. Family mode records spending without balances.
- **Add receipts** opens Money with the receipt form already open.

**Budget calculator.** A shared calculator takes known destination, dates and headcount and saves all worksheet inputs to the trip. It feeds the forecast, set against saved planned and recorded costs without double counting. The optional spending target sits inside the calculator. An estimate never creates an expense, split or debt. A blank worksheet means no estimate yet, not an incomplete trip.

**Settle up and payment reports.** People report a payment they made with **I paid someone**. A report is a record, not a transfer. Show the actual state of each report. Closing the ledger is a separate action. Never imply that Commons sent or received money.

**Trip ledger.** **Trip ledger** opens a permissioned page: the viewer's **Your balance** first, per currency, then the shared ledger. Identity comes from the server session, never from a name or id in the URL. **Share ledger** copies a stable link; the link grants no access, and people must sign in as members. **Export** holds **Print / Save PDF** and **Download CSV** from the same summary. Open ledgers are labelled open. Exports exclude private booking details, receipts, notes and conversations by an explicit field list. Keep exact cents, safe spreadsheet text and readable print pages.

## 15. Photos and covers

**Photos** is a destination in the rail. It shows the group's photos in their natural color with captions below. Do not put a dark overlay on a photo. Photos and money text never fade. Photos are grouped by trip dates, with their own group for out-of-range photos.

**Covers.** One cover control: **Add cover** before a photo is set and **Change cover** after. It opens the picker. The picker offers upload, a trip photo, or **Browse Commons covers**, a full gallery of bundled drawings shown right away without a search field. Choosing a bundled cover reuses the normal cover save and creates no gallery photo.

Until someone picks a cover, a bundled drawing is chosen from saved locations, then from a destination in the trip title, then from a neutral theme. With no context, show the empty state. An explicit cover always wins. There is no outside image lookup.

The cover photo sits uncropped in its original aspect ratio, within a 320px maximum height. If the image fails, the trip's artwork stays.

Only Trip has a cover in its content header. Plan, Money and Photos lead with their tools.

## 16. Messages with Commons

Messages is a private one-to-one conversation between a person and Commons, with optional texting for the same conversation.

- `/messages` shows the person's own thread across their trips. Each side is labelled **You** and **Commons** in words, not only by position.
- Commons asks one question at a time and answers from saved, permitted plan facts. Money and booking-related replies need an approval code. Quiet hours, pacing and STOP and START apply to texting.
- A message held for quiet hours shows as waiting, never as sent.
- `/messages/trip/[trip]` turns messages on or off for one trip with a consent checkbox. A trip's messages go to one place, so turning them on here moves them off a phone.
- A mobile number is confirmed in a separate step from turning on texts. Confirming never implies consent. Offer **Not now, go to the trip** after joining and **Skip for now** at account creation. These appear only when texting can actually be sent.
- An organizer's **Share an update** can add **Or write your own**. Commons posts it into each opted-in traveler's thread, with the organizer's name and "Replies come to Commons". It is not a group chat and nothing is emailed or pushed.
- Replies do not change the plan without the same approvals as the rest of the app.
- Copy never promises delivery that has not happened. Words change only for the channel: no number to save and no carrier line in the web thread.

## 17. Documents

Itineraries, polls, the ledger and legal pages share one reading style.

- A warm board behind one white paper with a quiet edge and no decorative shadow.
- Compact medium-weight headings, 15 to 16px prose, 1.55 line height, a 68ch measure.
- Rows separated by rules, not a card for every item. Days are separated by more space than a title and its note.
- Shared styles are in `packages/ui/src/documents.css`. Padding and page width are in `packages/ui/src/tokens.css`.
- A read-only document adds no autosave, permission or editor behavior.
- Legal pages use a narrow reading width, a title, version and effective date, numbered sections and an accessible contents list.
- Shared documents never show private organizer material. Build a participant view from an explicit list of fields. Do not render the organizer's version with controls hidden.

## 18. Motion and accessibility

- Small transitions take 160 to 220ms. Sheets take at most 420ms. Animate transform and opacity, not layout. No ambient movement. Pages do not replay an entrance animation on every switch.
- With reduced motion, changes are immediate. The duration tokens already drop to zero.
- Use semantic headings, real links and buttons, and full keyboard access.
- Targets are at least 44px. Mobile inputs are at least 16px.
- Focus is always visible. Dialogs trap focus and return it.
- Text must work at 200% zoom. Long names, places and dates wrap.
- Contrast is at least WCAG AA.
- Status uses words and shape as well as color.
- Progress announcements use one polite live region and announce when something settles, not every change.
- Do not expose private reasons through visual hints such as a lock or a hidden label.
- Show success only from a saved result. Failed saves keep the person's text and offer retry. A retry must not duplicate a record.

## 19. Implementation and checks

**Where things live.**
- Shared tokens: `packages/ui/src/tokens.css`.
- Shared document styles: `packages/ui/src/documents.css`. Button and action styles: `packages/ui/src/actions.css`.
- Mark and wordmark: `packages/ui/src/mark.tsx`.
- Templates: `packages/domain/src/plan-templates`.

**Rules.**
- Prefer semantic tokens and shared primitives to route-specific values. When a pattern repeats, move it into `packages/ui`.
- No raw color, spacing or size literals in route CSS when a token exists.
- `apps/web` is the only production web app.
- Use real buttons and links. Every control needs a visible focus state and a 44px target.
- Keep copy in the words defined here. Use "trip" everywhere. Use sentence case.
- Keep changes scoped. A visual change does not alter permissions, data or behavior.

**Before you ship a screen.**
1. Check 390px, 430px, tablet and desktop.
2. Check 200% zoom and a short viewport.
3. Check as an organizer and as a traveler, separately. Confirm the traveler sees no organizer or private fields.
4. Check empty, loading, error, saved and pending states.
5. Check keyboard use, focus return from dialogs and reduced motion.
6. Check long names and long labels for overlap, not only for horizontal scroll.
7. For the mark, check 16, 24, 32 and 48px rendering and the inverse version.
8. Run tests, typecheck, lint and build, and report anything that fails.

A screenshot or a bounding-box check alone does not show that a layout works. Exercise the interaction.
