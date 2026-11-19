import { redirect } from "next/navigation";
import { COORDINATOR_ENTRY_KEYS, commonsViewPath } from "@/lib/commons-route";

/** Preserve old thread/artifact/voice links; authorization and artifact validation happen in the shared trip entry. */
export default async function CoordinatorPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {slug}=await params, entry=await searchParams;
  const url=new URL(commonsViewPath(slug,"coordinator"),"http://localhost");
  for(const key of COORDINATOR_ENTRY_KEYS) if(typeof entry[key]==="string") url.searchParams.set(key,entry[key]);
  redirect(url.pathname+url.search);
}
