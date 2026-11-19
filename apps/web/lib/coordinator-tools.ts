export const coordinatorTools = [
  {label:"/add (flight, hotel, activity, meal, transport)",command:"/add",guidance:"Choose what to add. Review the details and save in its entry form."},
  {label:"/poll (create poll)",command:"/poll",guidance:"Add the question and choices. Commons prepares a private draft; sharing is separate."},
  {label:"/task (create task)",command:"/task",guidance:"Describe your task. Commons adds it for you; you can undo it."},
  {label:"/search (research a topic)",command:"/search",guidance:"Describe what to look up on the web. Prices and availability remain unverified."},
] as const;
/** Only a command at the beginning of the organizer's own typed message runs. */
export function coordinatorTool(text: string) {
  const match = /^\/(poll|task|search|book|add)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? {kind:match[1].toLowerCase() as "poll"|"task"|"search"|"book"|"add",request:match[2]?.trim() ?? ""} : null;
}
export function putComposerTool(text: string, command: string) {
  const content = coordinatorTool(text)?.request ?? text;
  const result = `${command} ${content}`;
  return result.length <= 30000 ? result : null;
}

export const coordinatorAddKinds = ["flight", "hotel", "activity", "meal", "transport"] as const;
export type CoordinatorAddKind = typeof coordinatorAddKinds[number];
export function addRecordCommand(text: string): CoordinatorAddKind | null {
  const match = /^\/add\s+(flight|hotel|activity|meal|transport)\s*$/i.exec(text.trim());
  return match ? match[1].toLowerCase() as CoordinatorAddKind : null;
}
export function slashCommandChoices(text: string, searchAvailable: boolean) {
  const add = /^\/add\s*([a-z]*)$/i.exec(text);
  if (add) return coordinatorAddKinds.filter(kind=>kind.startsWith(add[1].toLowerCase())).map(kind=>({command:`/add ${kind}`,label:kind[0].toUpperCase()+kind.slice(1),guidance:`Open the ${kind} entry form`}));
  if (!/^\/[a-z]*$/i.test(text)) return [];
  const names = {"/add":"Add","/poll":"Poll","/task":"Task","/search":"Search"} as const;
  const descriptions = {"/add":"Flight, hotel, activity, meal or transport","/poll":"Ask the group with a poll","/task":"Add a task for yourself","/search":"Research a topic"} as const;
  return coordinatorTools.filter(tool=>(tool.command!=="/search" || searchAvailable) && tool.command.startsWith(text.toLowerCase())).map(tool=>({...tool,label:names[tool.command],guidance:descriptions[tool.command]}));
}
