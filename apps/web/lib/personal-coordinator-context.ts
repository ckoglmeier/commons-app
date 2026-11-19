import type { CommonsSnapshot, TripTask } from "@commons/contracts";
import { coordinatorActionItems, coordinatorNextSteps, travelNextStepDescriptor } from "@commons/domain";

/** Explicit allowlist over an already permissioned snapshot. No original files, contacts, chats, audits, or another person’s task data. */
export function personalCoordinatorContext(snapshot:CommonsSnapshot, now=Date.now(), intake: {items?: Parameters<typeof coordinatorNextSteps>[0]["intakes"]; state?: "loaded" | "unavailable"; tasks?: readonly TripTask[]} = {}) {
  const {commons,state,currentActor}=snapshot;
  return {
    scope:{tripId:commons.id,personId:currentActor.id,audience:"personal",authority:"read_only"},
    trip:{name:commons.name,startsOn:commons.startsOn,endsOn:commons.endsOn,locationName:commons.locationName,timezone:commons.timezone},
    plans:state.itinerary.slice(0,50).map(item=>({id:item.id,title:item.title,status:item.status,startsAt:item.startsAt,location:item.location,note:item.note,provenance:item.provenanceLabel})),
    stays:(state.stays??[]).slice(0,12).map(stay=>({id:stay.id,name:stay.name,address:stay.address,startsOn:stay.startsOn,endsOn:stay.endsOn,status:stay.status,checkInTime:stay.checkInTime,checkOutTime:stay.checkOutTime})),
    ownTravel:(state.travelPlans??[]).filter(plan=>plan.personId===currentActor.id).slice(0,12).map(plan=>({id:plan.id,kind:plan.kind,route:plan.route,date:plan.date,time:plan.time})),
    tasks:(intake.tasks??[]).filter(task=>task.ownerPersonId===currentActor.id).slice(0,20).map(task=>({id:task.id,title:task.title,dueOn:task.dueOn,completed:task.completed,itemKind:task.itemKind,itemId:task.itemId})),
    todos:coordinatorActionItems({tripId:commons.id,personId:currentActor.id,organizer:false,state,tripTasks:(intake.tasks??[]).filter(task=>task.ownerPersonId===currentActor.id),travel:coordinatorNextSteps({commons,state,participants:snapshot.participants,personId:currentActor.id,now,travelState:"loaded",intakes:intake.items,intakeState:intake.state,uploadAvailable:false}).steps[0]}).slice(0,6),
    nextSteps:coordinatorNextSteps({commons,state,participants:snapshot.participants,personId:currentActor.id,now,travelState:"loaded",intakes:intake.items,intakeState:intake.state,uploadAvailable:false}).steps.slice(0,3).map(travelNextStepDescriptor),
    limitations:"Saved facts only. No live verification, booking, payment, messages, organizer conversations or tasks. Nothing can be changed from this chat.",
  };
}
