import { useState, useRef } from "react";

const API_BASE = "/api";

export default function ChatBar({ phone }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  async function handleAsk(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/query?phone=${encodeURIComponent(phone)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer || data.error || "No response" },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Try again." },
      ]);
    }

    setLoading(false);
    inputRef.current?.focus();
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 mb-5 animate-in">
      <div className="text-[9px] text-text-dim uppercase tracking-widest mb-3">
        Ask about your business
      </div>

      {/* Message history */}
      {messages.length > 0 && (
        <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-[12px] leading-relaxed ${
                m.role === "user"
                  ? "text-text-muted italic"
                  : "text-text-primary bg-surface-alt border border-border/50 rounded-lg p-3"
              }`}
            >
              {m.role === "user" ? `"${m.content}"` : m.content}
            </div>
          ))}
          {loading && (
            <div className="text-[11px] text-text-dim animate-pulse">
              Thinking...
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleAsk} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='Try "How much did I spend on meals?" or "Top expenses this month"'
          className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-[12px] text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent/50 transition-colors"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="bg-accent/20 text-accent px-4 py-2 rounded-lg text-[11px] font-500 hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
