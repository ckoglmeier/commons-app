import { z } from 'zod';
import { tripTypes } from './templates';
const date = z.string().date();
export const BriefSchema = z.object({
 version:z.literal(1), title:z.string().trim().min(1).max(80),
 destination:z.string().trim().max(100).optional(),
 templateSlug:z.string().refine(value=>tripTypes.some(t=>t.slug===value),'Choose a supported template.').optional(),
 start:date.optional(), end:date.optional(), welcome:z.string().trim().max(700).optional(),
 activities:z.array(z.string().trim().min(1).max(200)).max(20).optional(),
}).strict().superRefine((value,ctx)=>{
 if(Boolean(value.start)!==Boolean(value.end))ctx.addIssue({code:'custom',message:'Include both dates, or leave both unknown.'});
 if(value.start&&value.end&&value.end<value.start)ctx.addIssue({code:'custom',message:'The last day must follow the first day.'});
});
export type TripBrief=z.infer<typeof BriefSchema>;
export function parseBrief(text:string):{brief:TripBrief;error?:never}|{brief?:never;error:string}{
 if(text.length>15000)return {error:'Keep the brief under 15,000 characters.'};
 try {const result=BriefSchema.safeParse(JSON.parse(text));return result.success?{brief:result.data}:{error:result.error.issues.map(i=>i.code==='unrecognized_keys'?`Remove unsupported ${i.keys.length===1?'field':'fields'}: ${i.keys.join(', ')}. Use only the fields in the brief example.`:`${i.path.join('.')||'Brief'}: ${i.message}`).join(' ')};}catch{return {error:'Paste a JSON object using the example format.'};}
}
