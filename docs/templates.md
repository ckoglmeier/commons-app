# Templates

Commons coordinates group plans with real dates, places and shared money. A **template** decides what a new plan starts with. Trips are the default template. A family reunion ships as an example.

A template sets the starting questions, polls, plan section names, to-dos and money hints. It doesn't change how Commons works. The app still calls every plan a trip.

## Where templates live

```
packages/domain/src/plan-templates/
  format.ts          the format and its validator
  travel.ts          the trip template (the default)
  family-reunion.ts  the example
  index.ts           the list of bundled templates
```

To add one:

1. Copy `family-reunion.ts` to a new file, such as `ski-weekend.ts`, and change its contents.
2. Add it to `PLAN_TEMPLATES` in `index.ts`.
3. Run `npm test -w @commons/domain`. The tests check every bundled template against the format.

When more than one template exists, **New trip** asks what kind of plan it is. A link to `/new?template=<key>` starts with that template chosen.

## The format

```ts
export const skiWeekendTemplate: PlanTemplate = {
  key: "ski-weekend",
  version: 1,
  label: "Ski weekend",
  description: "Lift tickets, gear rentals and a shared cabin.",
  welcomeQuestions: [...],
  defaultPolls: [...],
  openQuestions: [...],
  planSections: {...},
  todos: [...],
  money: { costRules: [...] },
};
```

### `key` and `version`

`key` is stored on each plan, so never change it once people use it. Use 3 to 48 lowercase letters, numbers or dashes. Bump `version` when a change should only apply to plans created afterward. If a plan's key isn't bundled in your copy, it falls back to the trip template.

### `label` and `description`

What the organizer sees when choosing a template on **New trip**. Keep the label to a few words.

### `welcomeQuestions`

Every plan settles three questions before it's on: where, when and who. Their ids and order are fixed. A template words them.

```ts
welcomeQuestions: [
  { id: "where", title: "Which mountain?", help: "Add it if you know, or ask the group." },
  { id: "when", title: "Which weekend?", help: "Add the dates, or ask what could work." },
  { id: "who", title: "Who’s skiing?", help: "Add who’s coming, or ask." },
],
```

### `defaultPolls`

Ready-made polls the organizer can start from. A poll with `forQuestion` is the one **Ask your group** opens for that welcome question, so give each of where, when and who one poll. Other polls open from `/c/<trip>/polls/new?template=<poll id>`; no button opens them yet.

```ts
{
  id: "ski-when",
  forQuestion: "when",
  title: "Which weekend can you ski?",
  intro: "Pick every weekend that could work.",
  questions: [
    {
      id: "75000000-0000-4000-8000-000000000001",
      kind: "choice",
      prompt: "Which weekends could work?",
      required: true,
      selectionMode: "multiple",
      options: [option("75000000-0000-4000-8000-000000000011", ""), option("75000000-0000-4000-8000-000000000012", "")],
    },
  ],
},
```

- Question and option ids are UUIDs, unique across the template. Pick a prefix no other template uses.
- Questions are `kind: "choice"` (with `selectionMode` `"single"` or `"multiple"`) or `kind: "text"`.
- Leave an option's label empty for the organizer to fill in. Don't invent places, prices or dates.

### `openQuestions`

Things the group usually needs to settle beyond where, when and who, such as "Who's hosting the big dinner?". They're listed on the trip while it's getting going, and each one can start a poll. At most eight.

### `planSections`

Plan has two sections with fixed roles: things the group does together (`activities`) and how people get there and where they sleep (`travel`). A template can rename them and suggest a short outline that shows while the plan is empty. The outline is a hint; it's never saved as plan items.

```ts
planSections: {
  activities: { label: "On the mountain" },
  travel: { label: "Getting there & the cabin" },
  outline: ["Friday · Drive up and pick up rentals", "Saturday · Ski all day, group dinner", "Sunday · Half day and home"],
},
```

### `todos`

To-dos added for the organizer when the plan is created. They're ordinary to-dos the organizer can reassign, edit or delete. At most twelve.

### `money.costRules`

How each kind of cost is usually split:

- `shared`: everyone splits it, like the house.
- `per_person`: each person pays their own, like travel to get there.
- `optional`: only the people who opt in, like an outing.

Money shows these as a guide. The budget worksheet lists the optional ones as optional extras. They don't change how a cost is recorded. Whoever adds a cost still picks who shares it.

## Checking your template

- `npm test -w @commons/domain` validates every bundled template and reports each problem with its path.
- Start the app (`npm run dev`), choose your template on **New trip**, and check the welcome questions, **Ask your group** polls, plan section names, to-dos and Money.

## Keep in mind

- A template sets a starting point. The organizer can change everything it adds.
- Write the way people talk to each other, in short plain sentences.
- Don't write a template for something Commons doesn't do, such as ticketing or payments.
