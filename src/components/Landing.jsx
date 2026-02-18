import { useState } from "react";

export default function Landing({ onViewDashboard }) {
  const [phone, setPhone] = useState("");

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-16 text-center">
        <div className="text-6xl mb-6">📒</div>

        <h1 className="font-display text-4xl md:text-5xl font-800 tracking-tight mb-4 leading-tight">
          Your ledger book,
          <br />
          <span className="bg-gradient-to-r from-accent to-purple-400 bg-clip-text text-transparent">
            digitized instantly
          </span>
        </h1>

        <p className="text-text-muted text-sm md:text-base max-w-md leading-relaxed mb-10">
          Send a photo of your handwritten ledger to WhatsApp.
          AI extracts every transaction, categorizes expenses, and gives you
          a business dashboard — all for free.
        </p>

        {/* How it works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full mb-12">
          {[
            { icon: "📷", title: "1. Snap", desc: "Take a photo of your ledger page" },
            { icon: "💬", title: "2. Send", desc: "Send it to our WhatsApp number" },
            { icon: "📊", title: "3. Done", desc: "Get categorized data + dashboard" },
          ].map((step) => (
            <div
              key={step.title}
              className="bg-surface border border-border rounded-xl p-5 text-left"
            >
              <div className="text-2xl mb-2">{step.icon}</div>
              <div className="font-display font-600 text-sm mb-1">{step.title}</div>
              <div className="text-text-dim text-xs leading-relaxed">{step.desc}</div>
            </div>
          ))}
        </div>

        {/* WhatsApp CTA */}
        <a
          href="https://wa.me/14155238886?text=hi"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-3 bg-green-600 hover:bg-green-500 text-white font-display font-600 text-base px-8 py-4 rounded-xl transition-colors mb-4"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.612l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.352 0-4.55-.693-6.396-1.884l-.447-.287-2.638.884.884-2.638-.287-.447A9.956 9.956 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z" />
          </svg>
          Start on WhatsApp
        </a>
        <p className="text-text-dim text-xs">No app to install. No signup needed.</p>

        {/* Dashboard access */}
        <div className="mt-16 border-t border-border pt-8 w-full max-w-sm">
          <p className="text-text-dim text-xs uppercase tracking-widest mb-3">
            Already using it? View your dashboard
          </p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+94 77 123 4567"
              className="flex-1 bg-surface border border-border rounded-lg px-4 py-3 text-sm text-text-primary font-mono outline-none focus:border-accent transition-colors placeholder:text-text-dim"
            />
            <button
              onClick={() => phone.trim() && onViewDashboard(phone.trim())}
              disabled={!phone.trim()}
              className="bg-accent/20 border border-accent text-accent px-5 py-3 rounded-lg text-sm font-display font-600 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent/30 transition-colors"
            >
              View →
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-6 text-text-dim text-xs border-t border-border">
        Powered by Gemini Flash AI · Costs less than $0.001 per page
      </div>
    </div>
  );
}
