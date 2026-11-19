import "server-only";
import { beginPersonalCoordinatorTurn, finishPersonalCoordinatorTurn, personalCoordinatorHistory, listTripTasks, listConfirmationIntakes, getCommonsSnapshot, CommandAccessError } from "@commons/database";
import { authenticatedConfirmationIntakeOptions, isPublicDemoCommonsIdentifier } from "./commons";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";
import { coordinatorInferencePolicy } from "./coordinator-inference-policy";
import { converseWithCoordinator } from "./coordinator-review-inference";
import { personalCoordinatorContext } from "../personal-coordinator-context";

export async function authenticatedPersonalHistory(identifier:string) {
  if(isPublicDemoCommonsIdentifier(identifier))return [];
  return personalCoordinatorHistory(identifier,await authenticatedConfirmationIntakeOptions());
}
export async function personalCoordinatorQuestion(identifier:string,command:unknown,dependencies:{infer?:typeof converseWithCoordinator}={}) {
  const options=await authenticatedConfirmationIntakeOptions();
  if(isPublicDemoCommonsIdentifier(identifier))throw new CommandAccessError();
  // Resolve membership before context or inference. The model gets no mutation dispatcher or arbitrary retrieval tool.
  const begun=await beginPersonalCoordinatorTurn(identifier,command,options);
  if(!begun.execute)return begun.turn;
  try {
    const snapshot=await getCommonsSnapshot(identifier,options);
    if(!snapshot || snapshot.currentActor.id!==options.actorPersonId)throw new CommandAccessError();
    const history=await personalCoordinatorHistory(identifier,options);
    const tasks=await listTripTasks(identifier,options);
    let intakes: Awaited<ReturnType<typeof listConfirmationIntakes>> = [], intakeState: "loaded" | "unavailable" = "loaded";
    if(readCommonsRuntimeEnvironment().COMMONS_CONFIRMATION_INTAKE_ENABLED === "true") {
      try { intakes=await listConfirmationIntakes(identifier,options); } catch { intakeState="unavailable"; }
    }
    const policy=coordinatorInferencePolicy();
    if(!policy)throw new Error("unavailable");
    const model=policy.modelId(policy.models.conversation);
    if(!model)throw new Error("unavailable");
    const answer=await (dependencies.infer??converseWithCoordinator)(null,begun.turn.userText,{personal:true,apiKey:policy.apiKey,model,transport:policy.transport,providerPolicy:"private"},AbortSignal.timeout(60000),fetch,{
      tripContext:personalCoordinatorContext(snapshot,Date.now(),{items:intakes,state:intakeState,tasks}),conversation:history.filter(turn=>turn.status==="completed").slice(-8).flatMap(turn=>[{role:"user",text:turn.userText},{role:"assistant",text:turn.reply!}]),priorPolls:[],
    });
    // Recheck active membership at commit. Revocation while inference runs saves or exposes no answer.
    return finishPersonalCoordinatorTurn(identifier,{commandId:begun.turn.commandId,attempt:begun.attempt,reply:answer.reply},options);
  } catch(error) {
    await finishPersonalCoordinatorTurn(identifier,{commandId:begun.turn.commandId,attempt:begun.attempt,reply:null},options).catch(()=>undefined);
    throw error;
  }
}
