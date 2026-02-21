// api/lib/prompts/categorization.js
// Step 2: Categorize already-digitized rows (text-only, no image needed)

import { CATEGORIES } from "./extraction.js";

export function getCategorizationPrompt(rawRows, currency, pageNotes) {
  return `You are a bookkeeping assistant for small retail businesses (grocery shops, textile stores, general stores).

Categorize these digitized transactions into the correct categories.

## Input Data
Currency: ${currency || "unknown"}
Page notes: ${pageNotes || "none"}
Rows:
${JSON.stringify(rawRows, null, 2)}

## Categories
${CATEGORIES.map((c) => `- ${c}`).join("\n")}

## Category Guidelines
- "Inventory / Stock": goods purchased for resale, raw materials, stock replenishment (e.g., "Grocery - Main road", "Notions", "Rice 50kg")
- "Revenue / Sales": sales income, customer payments, returns/refunds (as negative credit)
- "Salaries / Wages": staff wages, daily labor, helper payments (e.g., "Roober Salary", "Helper")
- "Shop Expenses": shop rent, carpet, cleaning, decorations, signage, banners
- "Transport / Fuel": delivery charges, lorry hire, fuel, courier/parcel shipping (e.g., "WZ parcel")
- "Food / Meals": staff meals, tea, refreshments
- "Owner Drawings": cash to boss/owner, personal withdrawals (e.g., "Cash to Boss")
- "Marketing / Ads": sponsorships, advertising, flyers, social media, banner sponsorship
- "Utilities": electricity, water, phone, internet
- "Office Supplies": stationery, pens, notebooks, printing
- "Repairs / Maintenance": equipment repair, building maintenance
- "Insurance": insurance premiums
- "Taxes / Fees": government taxes, license fees, permits
- "Loan / Interest": loan payments, interest charges
- "Miscellaneous": ONLY if nothing else fits. Prefer specific categories.

## Rules
- For retail shops, most purchases are likely "Inventory / Stock" unless clearly something else
- Normalize dates to YYYY-MM-DD format where possible
- Preserve original descriptions
- Keep the same amount and type (debit/credit)

Return ONLY valid JSON (no markdown, no backticks):
{
  "transactions": [
    {
      "date": "YYYY-MM-DD or original if can't parse",
      "description": "original text",
      "amount": 1234.56,
      "type": "debit or credit",
      "category": "one of the categories above"
    }
  ],
  "currency_detected": "${currency || "unknown"}",
  "page_notes": "${pageNotes || ""}",
  "confidence": "high or medium or low"
}`;
}
