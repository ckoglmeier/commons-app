const maxFileBytes = 10 * 1_024 * 1_024;
const maxTextLength = 2_000_000;
import { readEmailText } from "./confirmation-file";

type PdfTextItem = { str: string; transform: number[]; width?: number };
type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getTextContent: (options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{ items: PdfTextItem[] }>;
  }>;
  destroy: () => void | Promise<void>;
};

async function readPdfText(buffer: Uint8Array) {
  // Use pdf-parse's bundled PDF.js directly so document cleanup can be
  // awaited. The wrapper calls destroy without awaiting it, which can let a
  // subsequent confirmation receive text cached from the prior document.
  // @ts-expect-error pdf-parse does not publish types for this subpath.
  const pdfModule = await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
  const pdfJs = (pdfModule.default ?? pdfModule) as unknown as {
    disableWorker: boolean;
    getDocument: (data: Uint8Array) => PromiseLike<PdfDocument>;
  };
  pdfJs.disableWorker = true;
  const document = await pdfJs.getDocument(buffer);
  try {
    if (document.numPages > 80) throw new Error("Choose a document with 80 pages or fewer.");
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let pageText = "";
      let lastY: number | undefined;
      let lastEnd: number | undefined;
      for (const item of content.items) {
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > 2) pageText += "\n";
        else if (lastEnd !== undefined && item.transform[4] - lastEnd > 2 && !pageText.endsWith(" ")) pageText += " ";
        pageText += item.str;
        lastY = y;
        lastEnd = item.transform[4] + (item.width ?? 0);
      }
      pages.push(pageText);
    }
    return pages.join("\n\n");
  } finally {
    await document.destroy();
  }
}

export async function readUploadedFile(file: File) {
  if (file.size > maxFileBytes) throw new Error("Choose a file smaller than 10 MB.");
  const lowerName = file.name.toLowerCase();
  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return {
      text: (await readPdfText(new Uint8Array(await file.arrayBuffer()))).slice(0, maxTextLength),
      sourceKind: "pdf" as const,
      sourceLabel: file.name,
    };
  }
  if (lowerName.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
    return {
      text: parsed.value.slice(0, maxTextLength),
      sourceKind: "word_document" as const,
      sourceLabel: file.name,
    };
  }
  if (/\.(xlsx|xls|ods)$/i.test(lowerName)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
    }).filter(Boolean).join("\n\n").slice(0, maxTextLength);
    if (!text.trim()) throw new Error("That workbook did not contain any readable rows.");
    return {
      text,
      sourceKind: "spreadsheet" as const,
      sourceLabel: file.name,
    };
  }
  if (!/\.(txt|md|csv|tsv|eml)$/i.test(file.name) && !file.type.startsWith("text/")) {
    throw new Error("Upload a PDF, Word document, text file, Markdown file, Google Sheets export, or Excel file.");
  }
  return {
    text: lowerName.endsWith(".eml") ? readEmailText(await file.text()) : (await file.text()).slice(0, maxTextLength),
    sourceKind: lowerName.endsWith(".eml") ? "email_export" as const : "text_file" as const,
    sourceLabel: file.name,
  };
}
