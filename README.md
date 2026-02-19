# 📒 Ledger Digitizer

AI-powered tool that turns photos of handwritten ledger books into structured, categorized financial data — via WhatsApp.

**Target users:** Small businesses, shops, and traders who still use physical books for daily expenses.

## How It Works

```
User sends photo on WhatsApp
        ↓
Twilio receives → triggers webhook
        ↓
Gemini Flash (Vision AI)
  - Reads handwriting
  - Extracts every transaction
  - Auto-categorizes expenses
        ↓
Supabase (stores structured data)
        ↓
WhatsApp reply with summary
  + Link to web dashboard (PWA)
```

## Architecture

| Component | Technology | Cost |
|-----------|-----------|------|
| AI/OCR | Gemini 2.0 Flash (Vision) | ~$0.001/page |
| WhatsApp | Twilio WhatsApp API | Free sandbox / ~$0.005/msg |
| Database | Supabase (Postgres) | Free tier (500MB) |
| Frontend | React + Vite (PWA) | Free on Vercel |
| Hosting | Vercel (serverless) | Free tier |

**Total cost per user per month (30 pages):** ~$0.03–0.20

## Setup Guide

### 1. Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account (free)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (free)
- A [Twilio](https://twilio.com) account (free sandbox for WhatsApp)
- A [Vercel](https://vercel.com) account (free)

### 2. Supabase Setup

1. Create a new Supabase project
2. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
3. Copy your project URL and keys from **Settings → API**

### 3. Twilio WhatsApp Setup

1. Sign up at [twilio.com](https://twilio.com)
2. Go to **Messaging → Try it Out → WhatsApp Sandbox**
3. Follow the instructions to connect your phone to the sandbox
4. Note your sandbox number (usually `+14155238886`)
5. Set the webhook URL (after deploying):
   - **When a message comes in:** `https://your-app.vercel.app/api/webhook/whatsapp`
   - **Method:** POST

### 4. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

For Vercel, add these in **Settings → Environment Variables**:

```
GEMINI_API_KEY=AIza...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SECRET_KEY=eyJ...
SUPABASE_PUBLISHABLE_KEY=eyJ...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
APP_URL=https://your-app.vercel.app
```

Also add frontend env vars prefixed with `VITE_`:
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

### 5. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add GEMINI_API_KEY
vercel env add SUPABASE_URL
# ... (add all env vars)

# Deploy to production
vercel --prod
```

### 6. Configure Twilio Webhook

After deploying, go to Twilio Console → WhatsApp Sandbox → set webhook:
```
https://your-app.vercel.app/api/webhook/whatsapp
```

### 7. Test It

1. Send "hi" to your WhatsApp sandbox number
2. You should get a welcome message
3. Send a photo of a ledger page
4. Get back categorized transactions + dashboard link!

## Local Development

```bash
# Install dependencies
npm install

# Start both frontend and backend
npm run dev:all

# Or separately:
npm run dev      # Frontend (Vite) on :5173
npm run server   # Backend (Express) on :3001
```

Use [ngrok](https://ngrok.com) to expose your local server for Twilio webhooks:
```bash
ngrok http 3001
# Set the ngrok URL as your Twilio webhook
```

## WhatsApp Commands

| Command | Response |
|---------|----------|
| Send photo | Extracts & categorizes transactions |
| `hi` / `help` | Welcome message with instructions |
| `summary` | This month's expense/income summary |
| `report` | Link to full web dashboard |

## Project Structure

```
ledger-digitizer/
├── api/                    # Vercel serverless functions
│   ├── webhook/whatsapp.js # WhatsApp webhook handler
│   ├── transactions/[phone].js
│   └── summary/[phone].js
├── server/
│   └── index.js           # Express server (local dev)
├── src/
│   ├── components/
│   │   ├── Dashboard.jsx  # Web dashboard with charts
│   │   └── Landing.jsx    # Landing page
│   ├── lib/
│   │   └── supabase.js    # Supabase client
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   └── schema.sql         # Database schema
├── vercel.json            # Vercel deployment config
└── vite.config.js         # Vite + PWA config
```

## Scaling & Next Steps

- **Custom categories:** Let users define their own chart of accounts via WhatsApp ("add category: Raw Materials")
- **Multi-language:** Gemini handles Sinhala, Tamil, Hindi handwriting — test and tune prompts
- **Receipt scanning:** Same pipeline works for individual receipts, not just ledger pages
- **PDF reports:** Generate monthly P&L and send via WhatsApp
- **Accountant access:** Share dashboard with accountant via link
- **Offline mode:** PWA caches data for offline dashboard viewing
- **Batch processing:** Support multiple photos in one message

## License

MIT
