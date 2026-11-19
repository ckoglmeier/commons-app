import assert from "node:assert/strict";
import test from "node:test";
import { identifyConfirmationFile, readEmailText } from "./confirmation-file";
import { readUploadedFile } from "./read-uploaded-file";
import { parseConfirmationText } from "@commons/domain";

test("file type comes from bytes, not a spoofed PDF extension", async () => {
  await assert.rejects(identifyConfirmationFile(new File(["<script>alert(1)</script>"], "booking.pdf", { type: "application/pdf" })));
  const png = new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh9kAAAAASUVORK5CYII=", "base64")], "image.png");
  assert.equal((await identifyConfirmationFile(png)).mimeType, "image/png");
  await assert.rejects(identifyConfirmationFile(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "truncated.png")));
  await assert.rejects(identifyConfirmationFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-big.png")));
});

test("MIME email extraction ignores attachments and does not duplicate HTML alternatives", async () => {
  const text = "Airline: United\nConfirmation number: ZX9QPL\nTrip total: $850.00";
  const email = `MIME-Version: 1.0\nContent-Type: multipart/alternative; boundary=example\n\n--example\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(text).toString("base64")}\n--example\nContent-Type: text/html\n\n<script>fetch('https://invalid.example')</script><p>Trip total: $999.00</p>\n--example\nContent-Type: text/plain\nContent-Disposition: attachment\n\nTrip total: $100.00\n--example--`;
  assert.equal(readEmailText(email), text);
  const source = await readUploadedFile(new File([email], "confirmation.eml"));
  const draft = parseConfirmationText({ text: source.text, sourceLabel: source.sourceLabel });
  assert.equal(draft.totalCents, 85000);
  assert.equal(draft.confirmationCode, "ZX9QPL");
});

test("HTML-only email becomes text without scripts or external loads", () => {
  const text = readEmailText("Content-Type: text/html\n\n<script>bad()</script><p>Flight: UA 100</p><p>Trip total: $100.00</p><img src='https://invalid.example'>");
  assert.match(text, /Flight: UA 100/);
  assert.doesNotMatch(text, /bad|https|script|<img/);
});
