import type { TravelPlan } from "@commons/contracts";

export function mergeTravelPlans(base: TravelPlan[], updates: TravelPlan[]) {
  let plans = [...base];
  updates.forEach((update) => {
    const updateIds = update.personIds ?? [update.personId];
    plans = plans.filter((plan) => {
      // Rentals are independent bookings, even with the same driver/travelers.
      if ((update.kind === "car_rental" || update.kind === "transport")) return plan.id !== update.id;
      if (plan.kind !== update.kind) return true;
      const planIds = plan.personIds ?? [plan.personId];
      return !planIds.some((personId) => updateIds.includes(personId));
    });
    plans.push(update);
  });
  return plans;
}
