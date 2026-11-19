import css from './pages.module.css';
const guidance: Record<string, [string, string, string]> = {
  'trip-templates': ['Which template fits your trip?', 'Start with the kind of group you’re bringing together. A reunion needs room for different households and arrival days; a golf trip needs a headcount for each round. Each template has questions, an outline and a worked cost example you can adapt.', 'Browse the examples freely. Request beta access when you’re ready to organize your own trip in Commons.'],
  'group-trip-planner': ['When does a group trip need a shared plan?', 'When dates, bookings and costs start getting lost in the conversation. Commons gives the organizer and travelers one place to find the decisions, arrival details and shared expenses.', 'For six friends arriving on two different days, Friday dinner may need four places while Saturday needs six. Keep both in the plan so everyone knows where to be.'],
  'group-organizers': ['How do you make the next trip easier to organize?', 'Keep a useful starting outline, then confirm the new dates, guests, room needs and spending approvals. Each trip has its own arrangements and expenses.', 'For ten overnight guests and two day visitors, plan twelve meal places and ten beds. Your organization’s safeguarding and spending rules still apply.'],
  'pricing': ['How would the group share a trip fee?', 'Our planned price is $20 for the whole trip. Five people splitting it equally would pay $4 each. The organizer could record that cost alongside the group’s other expenses.', 'The current closed beta has no trip fee. Future paid trips and discounted bundles are not on sale yet.'],
  'destinations': ['How should your group choose a destination?', 'Start with how people will get there, where you could stay and the things you want to do together. Then leave room for the outings people would rather choose for themselves.', 'Each guide includes a suggested plan, local sources and a budget calculator. Check current opening times and booking terms before making reservations.'],
};
export function PageGuidance({ page }: { page: string }) {
  const item = guidance[page];
  return item ? <section className={css.section}><h2>{item[0]}</h2><p>{item[1]}</p><p>{item[2]}</p></section> : null;
}
