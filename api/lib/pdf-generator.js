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

    // Column widths
    const pageWidth = doc.page.width - 80; // margins
    const cols = {
      date: { x: 40, w: pageWidth * 0.15 },
      description: { x: 40 + pageWidth * 0.15, w: pageWidth * 0.45 },
      amount: { x: 40 + pageWidth * 0.60, w: pageWidth * 0.22 },
      type: { x: 40 + pageWidth * 0.82, w: pageWidth * 0.18 },
    };

    const rowHeight = 22;

    // Header
    const headerY = doc.y;
    doc.rect(40, headerY, pageWidth, rowHeight).fill("#2a2a3a");
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
    doc.text("Date", cols.date.x + 4, headerY + 6, { width: cols.date.w });
    doc.text("Description", cols.description.x + 4, headerY + 6, { width: cols.description.w });
    doc.text("Amount", cols.amount.x + 4, headerY + 6, { width: cols.amount.w, align: "right" });
    doc.text("Type", cols.type.x + 4, headerY + 6, { width: cols.type.w, align: "center" });

    doc.y = headerY + rowHeight;

    // Data rows
    let totalDebit = 0;
    let totalCredit = 0;

    rows.forEach((row, i) => {
      const y = doc.y;

      // Check for page overflow
      if (y + rowHeight > doc.page.height - 60) {
        doc.addPage();
        doc.y = 40;
      }

      const currentY = doc.y;

      // Alternate row background
      if (i % 2 === 0) {
        doc.rect(40, currentY, pageWidth, rowHeight).fill("#f5f5f8");
      }

      // Row data
      doc.fontSize(8).font("Helvetica").fillColor("#333333");
      doc.text(row.date || "-", cols.date.x + 4, currentY + 6, { width: cols.date.w });
      doc.text(
        (row.description || "-").substring(0, 50),
        cols.description.x + 4,
        currentY + 6,
        { width: cols.description.w - 8 }
      );

      const amount = Number(row.amount) || 0;
      doc.text(
        amount.toLocaleString(undefined, { minimumFractionDigits: 2 }),
        cols.amount.x + 4,
        currentY + 6,
        { width: cols.amount.w - 8, align: "right" }
      );

      const isDebit = row.type === "debit";
      doc.fillColor(isDebit ? "#c0392b" : "#27ae60");
      doc.text(
        isDebit ? "Expense" : "Income",
        cols.type.x + 4,
        currentY + 6,
        { width: cols.type.w - 8, align: "center" }
      );

      if (isDebit) totalDebit += amount;
      else totalCredit += amount;

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
