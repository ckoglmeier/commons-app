import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseConfirmationText } from "@commons/domain";
import * as XLSX from "xlsx";
import { readUploadedFile } from "./read-uploaded-file";

function upload(name: string, bytes: Uint8Array, type: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

test("reads PDF text without executing the package debug fixture", async () => {
  const bytes = await readFile(path.resolve(process.cwd(), "../../node_modules/pdf-parse/test/data/01-valid.pdf"));
  const result = await readUploadedFile(upload("planning.pdf", bytes, "application/pdf"));

  assert.equal(result.sourceKind, "pdf");
  assert.ok(result.text.trim().length > 0);
});

const confirmationFixtures = [
  {
    fileName: "lodging-confirmation.pdf",
    expected: {
      kind: "stay",
      name: "Laguna House",
      startsOn: "2027-03-20",
      endsOn: "2027-03-26",
      confirmationCode: "LH27TEST",
      totalCents: 244_956,
    },
  },
  {
    fileName: "round-trip-flight-confirmation.pdf",
    expected: {
      kind: "flight",
      name: "United Airlines",
      startsOn: "2027-03-20",
      endsOn: "2027-03-26",
      confirmationCode: "ZX9QPL",
      totalCents: 85_000,
      travelSegments: [
        { kind: "arrival", date: "2027-03-20", route: "DEN → SNA", time: "10:25", departureTime: "08:35", arrivalTime: "10:25" },
        { kind: "departure", date: "2027-03-26", route: "SNA → DEN", time: "15:40", departureTime: "15:40", arrivalTime: "18:55" },
      ],
    },
  },
  {
    fileName: "car-rental-confirmation.pdf",
    expected: {
      kind: "car_rental",
      name: "Alamo",
      startsOn: "2027-03-20",
      endsOn: "2027-03-29",
      startTime: "11:15",
      endTime: "13:30",
      route: "SNA Airport → SNA Airport",
      confirmationCode: "C500377040",
      totalCents: 61_405,
    },
  },
] as const;

for (const fixture of confirmationFixtures) {
  test(`extracts a reviewed draft from ${fixture.fileName}`, async () => {
    const bytes = await readFile(new URL(`./fixtures/confirmations/${fixture.fileName}`, import.meta.url));
    const source = await readUploadedFile(upload(fixture.fileName, bytes, "application/pdf"));
    const draft = parseConfirmationText(source);

    assert.equal(source.sourceKind, "pdf");
    for (const [field, value] of Object.entries(fixture.expected)) {
      const actual = field === "travelSegments" ? draft.travelSegments?.map(({ connections, ...summary }) => { assert.equal(connections?.length, 1); return summary; }) : draft[field as keyof typeof draft];
      assert.deepEqual(actual, value, `${field} should be extracted from ${fixture.fileName}`);
    }
    assert.deepEqual(draft.warnings, []);
    if (fixture.fileName === "round-trip-flight-confirmation.pdf") {
      assert.deepEqual(draft.travelSegments?.map(leg => leg.connections?.[0].flightNumber), ["UA 1480", "UA 221"]);
    }
  });
}

test("keeps concurrent confirmation PDF extraction isolated", async () => {
  const results = await Promise.all(confirmationFixtures.map(async (fixture) => {
    const bytes = await readFile(new URL(`./fixtures/confirmations/${fixture.fileName}`, import.meta.url));
    return readUploadedFile(upload(fixture.fileName, bytes, "application/pdf"));
  }));

  assert.match(results[0]?.text ?? "", /LODGING CONFIRMATION/);
  assert.match(results[1]?.text ?? "", /FLIGHT RECEIPT/);
  assert.match(results[2]?.text ?? "", /CAR RENTAL CONFIRMATION/);
});

test("reads exported Word documents", async () => {
  const bytes = await readFile(path.resolve(process.cwd(), "../../node_modules/mammoth/test/test-data/single-paragraph.docx"));
  const result = await readUploadedFile(upload(
    "planning.docx",
    bytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ));

  assert.equal(result.sourceKind, "word_document");
  assert.ok(result.text.trim().length > 0);
});

for (const bookType of ["xlsx", "xls", "ods"] as const) {
  test(`reads exported ${bookType.toUpperCase()} workbooks`, async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Date", "Plan", "Time", "Place"],
      ["7/22/2027", "Dinner", "7:30 PM", "C Salt Wine Bar"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Plan");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType });
    const result = await readUploadedFile(upload(
      `planning.${bookType}`,
      bytes,
      bookType === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : bookType === "xls"
          ? "application/vnd.ms-excel"
          : "application/vnd.oasis.opendocument.spreadsheet",
    ));

    assert.equal(result.sourceKind, "spreadsheet");
    assert.match(result.text, /Dinner/);
    assert.match(result.text, /C Salt Wine Bar/);
  });
}

for (const extension of ["txt", "md"] as const) {
  test(`reads .${extension} planning notes`, async () => {
    const result = await readUploadedFile(upload(
      `planning.${extension}`,
      new TextEncoder().encode("Thursday, July 22\nDinner at 7:30 PM"),
      "text/plain",
    ));

    assert.equal(result.sourceKind, "text_file");
    assert.match(result.text, /Dinner/);
  });
}
