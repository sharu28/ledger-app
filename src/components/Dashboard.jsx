import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import ChatBar from "./ChatBar";

const CAT_COLORS = {
  "Revenue / Sales": "#22c98a",
  "Inventory / Stock": "#20c0a8",
  "Salaries / Wages": "#a07cf5",
  "Shop Expenses": "#7c6cf0",
  "Transport / Fuel": "#f08040",
  "Food / Meals": "#e860a0",
  Utilities: "#f0a830",
  "Office Supplies": "#20b8d0",
  "Marketing / Ads": "#b060f0",
  "Repairs / Maintenance": "#708090",
  "Owner Drawings": "#d4a030",
  Insurance: "#30a0e0",
  "Taxes / Fees": "#f0555a",
  "Loan / Interest": "#d03040",
  Miscellaneous: "#8a8070",
  "Rent / Lease": "#7c6cf0",
};

const API_BASE = "/api";

export default function Dashboard({ phone, onBack }) {
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("overview");
  const [filterCat, setFilterCat] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [txnRes, sumRes] = await Promise.all([
          fetch(`${API_BASE}/transactions/${encodeURIComponent(phone)}`),
          fetch(`${API_BASE}/summary/${encodeURIComponent(phone)}`),
        ]);
        const txns = await txnRes.json();
        const sum = await sumRes.json();
        setTransactions(Array.isArray(txns) ? txns : []);
        setSummary(sum);
      } catch (err) {
        console.error("Failed to load:", err);
      }
      setLoading(false);
    }
    load();
  }, [phone]);

  // ── Computed data ──────────────────────────────────────────────

  const thisMonth = useMemo(
    () => summary?.thisMonth || [],
    [summary]
  );

  const monthlyExpenses = useMemo(() => thisMonth.filter((t) => t.type === "debit").reduce((s, t) => s + Number(t.amount), 0), [thisMonth]);
  const monthlyIncome = useMemo(() => thisMonth.filter((t) => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0), [thisMonth]);

  const categoryData = useMemo(() => {
    const cats = {};
    thisMonth
      .filter((t) => t.type === "debit")
      .forEach((t) => { cats[t.category] = (cats[t.category] || 0) + Number(t.amount); });
    return Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value, color: CAT_COLORS[name] || "#666" }));
  }, [thisMonth]);

  const monthlyTrend = useMemo(() => {
    if (!summary?.allTransactions?.length) return [];
    const months = {};
    summary.allTransactions.forEach((t) => {
      const m = t.created_at?.slice(0, 7);
      if (!m) return;
      if (!months[m]) months[m] = { month: m, expenses: 0, income: 0 };
      if (t.type === "debit") months[m].expenses += Number(t.amount);
      else months[m].income += Number(t.amount);
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [summary]);

  const displayTxns = filterCat
    ? transactions.filter((t) => t.category === filterCat)
    : transactions;

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-text-dim text-sm animate-pulse">Loading your data...</div>
      </div>
    );
  }

  if (!transactions.length) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-5 text-center">
        <div className="text-5xl mb-4">📭</div>
        <h2 className="font-display text-xl font-600 mb-2">No transactions yet</h2>
        <p className="text-text-muted text-sm mb-6">
          Send a photo of your ledger page to WhatsApp to get started.
        </p>
        <button onClick={onBack} className="text-accent text-sm underline">← Back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-text-dim hover:text-text-muted text-sm">←</button>
            <div>
              <div className="font-display font-700 text-sm">Dashboard</div>
              <div className="text-text-dim text-[10px] font-mono">{phone}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-text-dim">
            <span>{summary?.totalPages || 0} pages</span>
            <span>·</span>
            <span>{transactions.length} txns</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-5">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-5 animate-in">
          {[
            { label: "Expenses", value: monthlyExpenses, color: "text-red-400", prefix: "" },
            { label: "Income", value: monthlyIncome, color: "text-emerald-400", prefix: "+" },
            { label: "Net", value: Math.abs(monthlyIncome - monthlyExpenses), color: monthlyIncome >= monthlyExpenses ? "text-emerald-400" : "text-red-400", prefix: monthlyIncome >= monthlyExpenses ? "+" : "-" },
          ].map((c) => (
            <div key={c.label} className="bg-surface border border-border rounded-xl p-4">
              <div className="text-[9px] text-text-dim uppercase tracking-widest mb-1">This Month</div>
              <div className="text-[10px] text-text-muted mb-2">{c.label}</div>
              <div className={`font-display font-700 text-lg ${c.color}`}>
                {c.prefix}{c.value.toLocaleString(undefined, { minimumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </div>

        {/* Chat bar */}
        <ChatBar phone={phone} />

        {/* Navigation */}
        <div className="flex gap-1 mb-5 bg-surface border border-border rounded-lg p-1 w-fit">
          {["overview", "transactions", "trends"].map((v) => (
            <button
              key={v}
              onClick={() => setActiveView(v)}
              className={`px-4 py-1.5 rounded-md text-[10px] uppercase tracking-wider font-500 transition-colors ${
                activeView === v
                  ? "bg-accent/20 text-accent"
                  : "text-text-dim hover:text-text-muted"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeView === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in">
            {/* Pie chart */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="text-[9px] text-text-dim uppercase tracking-widest mb-4">
                Expense Categories
              </div>
              {categoryData.length > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="w-36 h-36">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={categoryData}
                          dataKey="value"
                          cx="50%"
                          cy="50%"
                          innerRadius={30}
                          outerRadius={60}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {categoryData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "#141d2f",
                            border: "1px solid #1c2a45",
                            borderRadius: 8,
                            fontSize: 11,
                            color: "#dfe6f0",
                          }}
                          formatter={(val) => val.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-2">
                    {categoryData.slice(0, 5).map((c) => (
                      <button
                        key={c.name}
                        onClick={() => { setFilterCat(c.name); setActiveView("transactions"); }}
                        className="flex items-center gap-2 w-full text-left hover:bg-surface-alt rounded px-1 py-0.5 transition-colors"
                      >
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: c.color }} />
                        <span className="text-[11px] truncate flex-1">{c.name}</span>
                        <span className="text-[10px] text-text-muted font-mono">
                          {c.value.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-text-dim text-xs">No expense data yet</div>
              )}
            </div>

            {/* Recent transactions */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="text-[9px] text-text-dim uppercase tracking-widest mb-4">
                Recent Transactions
              </div>
              <div className="space-y-2">
                {transactions.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate">{t.description}</div>
                      <div className="text-[9px] text-text-dim">{t.date} · {t.category}</div>
                    </div>
                    <div className={`text-[12px] font-display font-600 ml-3 ${t.type === "credit" ? "text-emerald-400" : "text-text-primary"}`}>
                      {t.type === "credit" ? "+" : ""}{Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Transactions list */}
        {activeView === "transactions" && (
          <div className="animate-in">
            {filterCat && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] text-text-muted">Filtered:</span>
                <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded">{filterCat}</span>
                <button onClick={() => setFilterCat(null)} className="text-[10px] text-text-dim hover:text-red-400 ml-1">× Clear</button>
              </div>
            )}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border bg-surface-alt">
                    {["Date", "Description", "Category", "Amount"].map((h) => (
                      <th key={h} className={`px-4 py-2.5 text-[9px] text-text-dim uppercase tracking-wider font-500 ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayTxns.map((t) => (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-surface-alt/50 transition-colors">
                      <td className="px-4 py-2.5 text-text-muted whitespace-nowrap">{t.date}</td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate">{t.description}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[9px] px-2 py-0.5 rounded font-500"
                          style={{ background: `${CAT_COLORS[t.category] || "#666"}20`, color: CAT_COLORS[t.category] || "#999" }}
                        >
                          {t.category}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-display font-600 ${t.type === "credit" ? "text-emerald-400" : "text-text-primary"}`}>
                        {t.type === "credit" ? "+" : ""}{Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Trends */}
        {activeView === "trends" && (
          <div className="animate-in space-y-4">
            {/* Monthly income vs expenses */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="text-[9px] text-text-dim uppercase tracking-widest mb-4">Monthly Trend</div>
              {monthlyTrend.length > 1 ? (
                <div className="h-52">
                  <ResponsiveContainer>
                    <BarChart data={monthlyTrend}>
                      <XAxis dataKey="month" tick={{ fill: "#3d5278", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#3d5278", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#141d2f", border: "1px solid #1c2a45", borderRadius: 8, fontSize: 11, color: "#dfe6f0" }}
                        formatter={(val) => val.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      />
                      <Bar dataKey="expenses" fill="#f0555a" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="income" fill="#22c98a" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-text-dim text-xs">Need at least 2 months of data to show trends.</div>
              )}
            </div>

            {/* Net over time */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="text-[9px] text-text-dim uppercase tracking-widest mb-4">Net Balance Trend</div>
              {monthlyTrend.length > 1 ? (
                <div className="h-40">
                  <ResponsiveContainer>
                    <LineChart data={monthlyTrend.map((m) => ({ ...m, net: m.income - m.expenses }))}>
                      <XAxis dataKey="month" tick={{ fill: "#3d5278", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#3d5278", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#141d2f", border: "1px solid #1c2a45", borderRadius: 8, fontSize: 11, color: "#dfe6f0" }}
                        formatter={(val) => val.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      />
                      <Line type="monotone" dataKey="net" stroke="#4d8eff" strokeWidth={2} dot={{ fill: "#4d8eff", r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-text-dim text-xs">More data needed.</div>
              )}
            </div>

            {/* Category bar chart */}
            <div className="bg-surface border border-border rounded-xl p-5">
              <div className="text-[9px] text-text-dim uppercase tracking-widest mb-4">Expenses by Category</div>
              {categoryData.length > 0 ? (
                <div className="h-48">
                  <ResponsiveContainer>
                    <BarChart data={categoryData} layout="vertical">
                      <XAxis type="number" tick={{ fill: "#3d5278", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fill: "#7e93b5", fontSize: 9 }} axisLine={false} tickLine={false} width={100} />
                      <Tooltip
                        contentStyle={{ background: "#141d2f", border: "1px solid #1c2a45", borderRadius: 8, fontSize: 11, color: "#dfe6f0" }}
                        formatter={(val) => val.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {categoryData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-text-dim text-xs">No data yet.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
