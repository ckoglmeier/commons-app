import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
const tables=["coordinator_goals","coordinator_goal_steps","coordinator_goal_events","coordinator_goal_reports","coordinator_goal_suggestion_dismissals","coordinator_outreach","coordinator_outreach_messages","trip_brain_settings","trip_brain_reviews","trip_brain_recommendations","confirmation_intakes","coordinator_worker_health"];
test("goal/Brain/intake side tables deny browser-role reads and writes even with table grants",{skip:process.env.COMMONS_RUN_DATABASE_TESTS!=="1"},async()=>{
 const url=process.env.TEST_DATABASE_URL;assert.ok(url&&new URL(url).hostname==="127.0.0.1"&&new URL(url).pathname.endsWith("_test"));
 const db=postgres(url,{max:1});
 try{
  const rows=await db`select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any(${tables})`;
  assert.equal(rows.length,tables.length);assert.ok(rows.every(row=>row.relrowsecurity));
  for(const role of ["anon","authenticated"]){
   await assert.rejects(db.begin(async tx=>{
    await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tables.join(",")} TO ${role}`);
    await tx`insert into coordinator_worker_health (kind,seen_at) values ('rls_synthetic',now()) on conflict (kind) do update set seen_at=excluded.seen_at`;
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    for(const table of tables){const [row]=await tx.unsafe(`select count(*)::int as total from ${table}`);assert.equal(row.total,0,`${role} cannot see ${table}`);}
    await tx.unsafe("SAVEPOINT refused_write");
    await assert.rejects(tx`insert into coordinator_worker_health (kind,seen_at) values ('forbidden_browser_write',now())`,(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="42501");
    await tx.unsafe("ROLLBACK TO SAVEPOINT refused_write");
    throw new Error("qualification_rollback");
   }),/qualification_rollback/);
  }
 }finally{await db.end();}
});
