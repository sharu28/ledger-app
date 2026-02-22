// api/health.js - Health check + R2 diagnostics
import { uploadToR2 } from "../lib/r2.js";

export default async function handler(req, res) {
  const diagnostics = {
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ? "set" : "MISSING",
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID
        ? `${process.env.R2_ACCESS_KEY_ID.length} chars`
        : "MISSING",
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? "set" : "MISSING",
      R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || "MISSING",
      R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || "MISSING",
    },
  };

  // If ?test=r2, try an actual upload
  if (req.query.test === "r2") {
    try {
      const url = await uploadToR2(
        "test/health-check.txt",
        Buffer.from("health check " + new Date().toISOString()),
        "text/plain"
      );
      diagnostics.r2 = { status: "ok", url };
    } catch (err) {
      diagnostics.r2 = { status: "error", message: err.message, code: err.Code || err.name };
    }
  }

  res.json(diagnostics);
}
