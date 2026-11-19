import test from "node:test";
import assert from "node:assert/strict";
import {lodgingCost} from "./lodging-cost";
const price = {basis:"per_room" as const,period:"nightly" as const,currency:"USD",minCents:32000,maxCents:32000,fees:"unknown" as const};
test("lodging basis, quantities, rounding and taxes stay explicit",()=>{
 assert.deepEqual(lodgingCost(price,{rooms:3,nights:2,travelers:6}).totalCents,[192000,192000]);
 assert.deepEqual(lodgingCost(price,{rooms:3,nights:2,travelers:6}).perPersonCents,[32000,32000]);
 assert.deepEqual(lodgingCost({...price,minCents:101,maxCents:101},{rooms:2,nights:3,travelers:4}).perPersonCents,[152,152]);
 assert.equal(lodgingCost(price,{rooms:null,nights:2,travelers:6}).totalCents,null);
 assert.equal(lodgingCost({...price,minCents:100_000_000,maxCents:100_000_000},{rooms:10000,nights:10000,travelers:1}).totalCents,null,"unsafe minor-unit products cannot become precise estimates");
 assert.equal(lodgingCost(price,{rooms:3,nights:2,travelers:null}).perPersonCents,null);
 assert.deepEqual(lodgingCost({...price,basis:"per_person",period:"stay"},{rooms:null,nights:null,travelers:null}).perPersonCents,[32000,32000]);
 assert.deepEqual(lodgingCost({...price,basis:"total",period:"stay"},{rooms:null,nights:null,travelers:4}).perPersonCents,[8000,8000]);
 assert.match(lodgingCost(price,{rooms:3,nights:2,travelers:6}).description,/fees unknown.*Not a quote/);
});
