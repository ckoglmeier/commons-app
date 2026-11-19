import { z } from 'zod';
import { BriefSchema } from './assistant-brief';
import { tripTypes } from './templates';
/** JSON Schema describes field shape. Runtime validation additionally checks date order. */
export function assistantBriefJsonSchema() {
 const schema={...z.toJSONSchema(BriefSchema),$id:'urn:commons:trip-brief:v1',description:'Manual organizer-reviewed trip brief. Dates must both be present or both absent; end must not precede start. Commons runtime validation is authoritative.',dependentRequired:{start:['end'],end:['start']}};
 if(schema.properties?.templateSlug) schema.properties.templateSlug={type:'string',enum:tripTypes.map(t=>t.slug)};
 return schema;
}
