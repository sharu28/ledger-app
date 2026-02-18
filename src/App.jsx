import { useState, useEffect } from "react";
import Dashboard from "./components/Dashboard";
import Landing from "./components/Landing";

export default function App() {
  const [page, setPage] = useState("landing");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    // Check URL for dashboard access via WhatsApp link
    const params = new URLSearchParams(window.location.search);
    const p = params.get("phone");
    const path = window.location.pathname;

    if (path.includes("dashboard") && p) {
      setPhone(p);
      setPage("dashboard");
    }
  }, []);

  if (page === "dashboard" && phone) {
    return <Dashboard phone={phone} onBack={() => setPage("landing")} />;
  }

  return (
    <Landing
      onViewDashboard={(ph) => {
        setPhone(ph);
        setPage("dashboard");
      }}
    />
  );
}
