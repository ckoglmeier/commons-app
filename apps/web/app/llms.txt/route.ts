import { marketingRoutesEnabled, marketingOrigin } from '@/lib/marketing/route-mode';
export const dynamic='force-dynamic';
export function GET(){
 if(!marketingRoutesEnabled())return new Response(null,{status:404});
 const origin=marketingOrigin();
 return new Response(`# Commons\n\nCommons helps groups collect answers, make trip decisions, keep separate travel arrangements together and track shared expenses. App access is by beta request.\n\n## Discovery\n- [Trip templates](${origin}/trip-templates/)\n- [Destinations](${origin}/destinations/)\n- [Clubs and community groups](${origin}/group-organizers/)\n- [AI preparation guide](${origin}/assistants/)\n- [ChatGPT](${origin}/assistants/chatgpt/)\n- [Claude](${origin}/assistants/claude/)\n- [Google Gemini](${origin}/assistants/gemini/)\n- [Brief format and capability boundaries](${origin}/docs/assistant-handoff/)\n- [JSON schema](${origin}/docs/assistant-handoff/schema/)\n\n## Limits\nNo public create/update API, native assistant connector, MCP endpoint or imported-brief save is available. Preparing a brief does not create a trip, book, invite, charge or share private data. Only use documented public links. Request beta access through the website.\n`,{headers:{'Content-Type':'text/plain; charset=utf-8','X-Robots-Tag':'noindex'}});
}
