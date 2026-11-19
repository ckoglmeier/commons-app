import test from "node:test";
import assert from "node:assert/strict";
import { pollIntroductionOnly } from "./coordinator-poll-edit";
import { converseWithCoordinator } from "./coordinator-review-inference";
import { PollWorkingDataSchema } from "@commons/contracts";
const prompt="Make this poll’s introduction shorter. Keep the two restaurant options unchanged. Do not create another poll or share it.";
const data=PollWorkingDataSchema.parse({title:"Dinner",intro:"Choose between our two dinner options for the weekend.",communication:{heading:"Delivery",paragraphs:["Separate delivery message"],links:[]},questions:[],ballotMode:"transparent"});
test("introduction wording has a bounded target distinct from preserved fields and mixed edits",()=>{
  for(const value of [prompt,"Shorten the poll intro","Could you rewrite its introduction?","Set this poll’s introduction to exactly: Choose your dinner preference. Keep its title, restaurant options and group message unchanged."])assert.equal(pollIntroductionOnly(value),true,value);
  for(const value of ["Is the introduction too long?","Change the delivery message","Shorten the intro and the message","Rewrite its introduction. Change the title too."])assert.equal(pollIntroductionOnly(value),false,value);
});
test("provider contract constrains intro-only proposals; adversarial field drift fails unchanged",async()=>{
  const original=structuredClone(data);
  for(const drift of [false,true]){
    const result=converseWithCoordinator(data,prompt,{apiKey:"test",model:"test",workspace:true},undefined,async(_,options)=>{
      const body=JSON.parse(options!.body as string),schema=body.response_format.json_schema.schema;
      assert.equal(schema.properties.message.type,"null");assert.equal(schema.properties.title.type,"null");
      assert.equal(schema.properties.operations.maxItems,0);assert.equal(schema.properties.edits.maxItems,0);
      assert.match(body.messages.map((row:{content:string})=>row.content).join("\n"),/only Poll Introduction/);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({reply:"I shortened it",title:null,intro:"Choose your dinner preference.",message:drift?{heading:"Wrong field",paragraphs:["Wrong"]}:null,edits:[],operations:[]})}}]});
    });
    if(drift)await assert.rejects(result);else assert.equal((await result).intro,"Choose your dinner preference.");
    assert.deepEqual(data,original);
  }
});
