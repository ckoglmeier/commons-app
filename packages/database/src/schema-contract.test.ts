import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSchemaContract,
  schemaContractFingerprint,
  schemaContractSummary,
  type SchemaContract,
} from "./schema-contract";

const emptyContract = (): SchemaContract => ({
  tables: [],
  columns: [],
  constraints: [],
  indexes: [],
  enums: [],
  policies: [],
  functions: [],
  triggers: [],
  storageBuckets: [],
});

test("schema fingerprints ignore catalog row and property order", () => {
  const first = emptyContract();
  first.tables = [
    { table_name: "people", definition: "CREATE TABLE people" },
    { table_name: "commons", definition: "CREATE TABLE commons" },
  ];
  const second = emptyContract();
  second.tables = [
    { definition: "CREATE TABLE commons", table_name: "commons" },
    { definition: "CREATE TABLE people", table_name: "people" },
  ];

  assert.deepEqual(normalizeSchemaContract(first), normalizeSchemaContract(second));
  assert.equal(schemaContractFingerprint(first), schemaContractFingerprint(second));
});

test("schema fingerprints preserve whitespace inside SQL literals", () => {
  const first = emptyContract();
  first.functions = [{ definition: "SELECT 'a  b'" }];
  const second = emptyContract();
  second.functions = [{ definition: "SELECT 'a b'" }];
  assert.notEqual(schemaContractFingerprint(first), schemaContractFingerprint(second));
});

test("enum fingerprints survive restore renumbering but detect reordered labels", () => {
  const before = emptyContract(), after = emptyContract();
  before.enums = [{ enum_name: "state", value: "idea", position: 0 }, { enum_name: "state", value: "planned", position: 0.5 }];
  after.enums = [{ enum_name: "state", value: "idea", position: 1 }, { enum_name: "state", value: "planned", position: 2 }];
  assert.equal(schemaContractFingerprint(before), schemaContractFingerprint(after));
  after.enums[0].position = 3;
  assert.notEqual(schemaContractFingerprint(before), schemaContractFingerprint(after));
});

test("schema fingerprints fail closed when a contract value changes", () => {
  const expected = emptyContract();
  expected.columns = [{ table_name: "people", column_name: "display_name", not_null: true }];
  const changed = emptyContract();
  changed.columns = [{ table_name: "people", column_name: "display_name", not_null: false }];

  assert.notEqual(schemaContractFingerprint(expected), schemaContractFingerprint(changed));
  assert.deepEqual(schemaContractSummary(expected), {
    tables: 0,
    columns: 1,
    constraints: 0,
    indexes: 0,
    enums: 0,
    policies: 0,
    functions: 0,
    triggers: 0,
    storageBuckets: 0,
  });
});
