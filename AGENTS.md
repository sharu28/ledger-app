# Ledger Digitizer - Agent Guide

AI-powered tool that turns photos of handwritten ledger books into structured, categorized financial data — via WhatsApp.

## Project Overview

**Target users:** Small businesses, shops, and traders who still use physical books for daily expenses.

**Workflow:**
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

## Technology Stack

| Component | Technology | Cost |
|-----------|-----------|------|
| AI/OCR | Gemini 2.0 Flash (Vision) | ~$0.001/page |
| WhatsApp | Twilio WhatsApp API | Free sandbox / ~$0.005/msg |
| Database | Supabase (Postgres) | Free tier (500MB) |
| Frontend | React + Vite (PWA) | Free on Vercel |
| Hosting | Vercel (serverless) | Free tier |

## Project Structure

```
ledger-digitizer/
├── api/                    # Vercel serverless functions
│   ├── webhook/whatsapp.js # WhatsApp webhook handler
│   ├── transactions/[phone].js  # GET transactions by phone
│   └── summary/[phone].js       # GET summary by phone
├── server/
│   └── index.js           # Express server (local development)
├── src/                   # React frontend
│   ├── components/
│   │   ├── Dashboard.jsx  # Web dashboard with charts
│   │   └── Landing.jsx    # Landing page
│   ├── lib/
│   │   └── supabase.js    # Supabase client (uses VITE_ env vars)
│   ├── App.jsx            # Main app with routing logic
│   ├── main.jsx           # React entry point
│   └── index.css          # Tailwind + custom styles
├── supabase/
│   └── schema.sql         # Database schema + RLS policies
├── index.html             # HTML entry with Google Fonts
├── package.json           # Dependencies and scripts
├── vite.config.js         # Vite + PWA configuration
├── vercel.json            # Vercel deployment config
├── tailwind.config.js     # Custom dark theme colors
└── postcss.config.js      # PostCSS with Tailwind
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Frontend only (Vite dev server on :5173)
npm run dev

# Backend only (Express server on :3001)
npm run server

# Both frontend and backend concurrently
npm run dev:all

# Production build
npm run build

# Preview production build
npm run preview
```

### Local Development with Webhooks

Use [ngrok](https://ngrok.com) to expose your local server for Twilio webhooks:

```bash
ngrok http 3001
# Set the ngrok URL as your Twilio webhook: https://xxxx.ngrok.io/webhook/whatsapp
```

## Environment Variables

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

### Backend Variables (server-side only)

```
GEMINI_API_KEY=AIza...                    # Google AI Studio API key
SUPABASE_URL=https://xxx.supabase.co      # Supabase project URL
SUPABASE_SECRET_KEY=eyJ...                # Supabase secret key (server-side only)
SUPABASE_PUBLISHABLE_KEY=eyJ...           # Supabase publishable key
TWILIO_ACCOUNT_SID=AC...                  # Twilio account SID
TWILIO_AUTH_TOKEN=...                     # Twilio auth token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886  # Twilio WhatsApp number
APP_URL=https://your-app.vercel.app       # Public app URL
PORT=3001                                 # Local server port
```

### Frontend Variables (must be prefixed with VITE_)

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

## Database Schema

Three main tables:

1. **users** - Identified by WhatsApp phone number
   - `phone` (TEXT, UNIQUE) - Primary identifier
   - `currency` (TEXT) - Default 'LKR'
   - `custom_categories` (TEXT[]) - User-defined categories

2. **pages** - Metadata for each scanned ledger page
   - Links to user
   - Stores AI confidence, detected currency, page notes

3. **transactions** - Individual financial transactions
   - `type` - 'debit' or 'credit'
   - `category` - One of 14 predefined categories
   - `is_unclear` - Flagged if AI wasn't confident

### Predefined Categories

```javascript
[
  "Revenue / Sales", "Rent / Lease", "Salaries / Wages", "Utilities",
  "Office Supplies", "Transport / Fuel", "Food / Meals", "Inventory / Stock",
  "Marketing / Ads", "Repairs / Maintenance", "Insurance", "Taxes / Fees",
  "Loan / Interest", "Miscellaneous"
]
```

### Views

- `monthly_summary` - Aggregated monthly totals per user
- `category_breakdown` - Category totals per month

## Code Style Guidelines

### Frontend (React)

- Use functional components with hooks
- Tailwind CSS for all styling (custom color palette defined in `tailwind.config.js`)
- Dark theme only (`#06090f` background, `#dfe6f0` text)
- Monospace font (`JetBrains Mono`) for data, sans-serif (`Outfit`) for headings
- Lucide React for icons
- Recharts for data visualization

### Backend

- ES modules (`"type": "module"` in package.json)
- Async/await for all async operations
- Environment variables via `process.env`
- Error handling with try/catch

### Naming Conventions

- Components: PascalCase (`Dashboard.jsx`)
- Utilities/Helpers: camelCase (`formatReply`)
- API routes: Bracket notation for dynamic segments (`[phone].js`)
- Database columns: snake_case
- JavaScript variables: camelCase

## API Endpoints

### Webhook (Twilio)

```
POST /webhook/whatsapp
```

Handles incoming WhatsApp messages from Twilio. Processes images via Gemini AI and text commands.

### Dashboard API

```
GET /api/user/:phone           # Get user by phone
GET /api/transactions/:phone   # Get transactions (optional ?month=YYYY-MM&category=X)
GET /api/summary/:phone        # Get summary stats
GET /health                    # Health check
```

## WhatsApp Commands

| Command | Response |
|---------|----------|
| Send photo | Extracts & categorizes transactions |
| `hi` / `help` | Welcome message with instructions |
| `summary` | This month's expense/income summary |
| `report` / `dashboard` | Link to full web dashboard |

## Deployment

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add GEMINI_API_KEY
# ... (add all required env vars)

# Deploy to production
vercel --prod
```

### Twilio Webhook Configuration

After deploying, configure the webhook in Twilio Console:

```
URL: https://your-app.vercel.app/api/webhook/whatsapp
Method: POST
```

## Security Considerations

1. **Secret Key**: Never expose `SUPABASE_SECRET_KEY` in frontend code. Only use in server/API routes.

2. **Publishable Key**: `SUPABASE_PUBLISHABLE_KEY` is safe to expose and used in frontend with phone-based auth.

3. **RLS Policies**: Database uses Row Level Security. Service role bypasses RLS for backend operations.

4. **Twilio Auth**: Webhook requests should ideally be validated with Twilio's request signature (not currently implemented).

5. **Environment Variables**: Store sensitive keys in Vercel environment variables, never commit to git.

## PWA Configuration

The app is configured as a Progressive Web App:

- **Icons**: `/icon-192.png`, `/icon-512.png` (need to be added)
- **Theme Color**: `#06090f`
- **Display Mode**: `standalone`
- **Auto-update**: Enabled via `vite-plugin-pwa`

## Common Issues

1. **CORS errors**: The Vite dev server proxies `/api` to `http://localhost:3001` during development.

2. **Twilio media access**: Images from Twilio require Basic Auth with Account SID and Auth Token.

3. **Gemini API limits**: Free tier has rate limits. Monitor usage in Google AI Studio.

4. **Phone number format**: Always stored with country code (e.g., `+94771234567`).

## Future Enhancements

- Custom categories via WhatsApp commands
- Multi-language support (Sinhala, Tamil, Hindi handwriting)
- PDF report generation
- Offline mode with PWA caching
- Batch processing for multiple photos
