import test from "node:test";
import assert from "node:assert/strict";
import {clockTime} from "./clock-time";
import {locationTimezones} from "./server/location-timezone-catalog";
test("local clocks use explicit AM/PM without date/timezone conversion",()=>{assert.equal(clockTime("00:00"),"12:00 AM");assert.equal(clockTime("12:00"),"12:00 PM");assert.equal(clockTime("13:12"),"1:12 PM");assert.equal(clockTime(null),"Time not set");});
test("location lookup offers sourced timezone matches, leaves unknown places unresolved",async()=>{assert.equal((await locationTimezones("SFO"))[0].timezone,"America/Los_Angeles");assert.ok((await locationTimezones("London")).some(item=>item.timezone==="Europe/London"));assert.deepEqual(await locationTimezones("Made-up city 987"),[]);});
