// api/lib/pdf-generator.js
// Generate a PDF table from digitized ledger rows

import PDFDocument from "pdfkit";

export async function generateDigitizedPDF(extraction) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title
    doc.fontSize(16).font("Helvetica-Bold").text("Digitized Ledger Page", { align: "center" });
    doc.moveDown(0.5);

    // Metadata
    doc.fontSize(9).font("Helvetica").fillColor("#666666");
    doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`);
    if (extraction.page_notes) doc.text(`Notes: ${extraction.page_notes}`);
    if (extraction.currency_detected && extraction.currency_detected !== "unknown") {
      doc.text(`Currency: ${extraction.currency_detected}`);
    }
    doc.text(`Confidence: ${extraction.confidence || "N/A"}`);
    doc.moveDown(1);

    // Table
    const rows = extraction.rows || [];
    if (!rows.length) {
      doc.fontSize(12).fillColor("#000000").text("No entries found.", { align: "center" });
      doc.end();
      return;
    }

    // Use image-detected headers if available, else fall back to legacy fixed columns
    const rawHeaders = extraction.headers && extraction.headers.length
      ? extraction.headers
      : ["date", "description", "amount", "type"];

    const pageWidth = doc.page.width - 80; // margins
    const rowHeight = 22;
    const colPad = 4;

    // Assign column widths — give description-like columns more space
    const descKeys = new Set(["description", "particulars", "details", "narration", "remarks", "note", "notes"]);
    const totalWeight = rawHeaders.reduce((sum, h) => sum + (descKeys.has(h.toLowerCase()) ? 3 : 1), 0);
    let xCursor = 40;
    const colDefs = rawHeaders.map((h) => {
      const weight = descKeys.has(h.toLowerCase()) ? 3 : 1;
      const w = (pageWidth * weight) / totalWeight;
      const def = { label: h, x: xCursor, w };
      xCursor += w;
      return def;
    });

    // Header row
    const headerY = doc.y;
    doc.rect(40, headerY, pageWidth, rowHeight).fill("#2a2a3a");
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
    colDefs.forEach((col) => {
      doc.text(col.label, col.x + colPad, headerY + 6, { width: col.w - colPad * 2 });
    });
    doc.y = headerY + rowHeight;

    // Data rows
    let totalDebit = 0;
    let totalCredit = 0;

    rows.forEach((row, i) => {
      if (doc.y + rowHeight > doc.page.height - 60) {
        doc.addPage();
        doc.y = 40;
      }

      const currentY = doc.y;

      if (i % 2 === 0) {
        doc.rect(40, currentY, pageWidth, rowHeight).fill("#f5f5f8");
      }

      // _type and _amount are system fields added by the digitization prompt
      const rowType = row._type || row.type || "unknown";
      const isDebit = rowType === "debit";
      const amount = Number(row._amount ?? row.amount) || 0;

      colDefs.forEach((col) => {
        const value = String(row[col.label] ?? "-");
        doc.fontSize(8).font("Helvetica").fillColor("#333333");
        doc.text(value.substring(0, 60), col.x + colPad, currentY + 6, {
          width: col.w - colPad * 2,
        });
      });

      if (isDebit) totalDebit += amount;
      else if (rowType === "credit") totalCredit += amount;

      doc.y = currentY + rowHeight;
    });

    // Summary footer
    doc.moveDown(0.5);
    const summaryY = doc.y;
    doc.rect(40, summaryY, pageWidth, 1).fill("#cccccc");
    doc.moveDown(0.5);

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#333333");
    doc.text(`Total Entries: ${rows.length}`, 44);
    doc.text(
      `Total Expenses: ${totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      44
    );
    doc.text(
      `Total Income: ${totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      44
    );
    const net = totalCredit - totalDebit;
    doc.text(
      `Net: ${net.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      44
    );

    doc.end();
  });
}
