// api/health.js - Simple health check to test Vercel function detection
export default function handler(req, res) {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
}
