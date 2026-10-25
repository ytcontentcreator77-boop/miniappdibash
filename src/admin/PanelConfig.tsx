import { useState } from "preact/hooks";

export function PanelConfig() {
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");

  const save = async () => {
    setMsg("Testing...");
    const res = await fetch("/api/admin/panel/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base, key })
    });
    const data = await res.json();
    if (res.ok) setMsg("Saved successfully! Catalog will sync on next cron.");
    else setMsg("Error: " + data.error);
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-xl font-bold">Reseller API Settings</h2>
      <input 
        placeholder="API URL (e.g. https://my-panel.com/api/v2)" 
        value={base} onChange={e => setBase(e.currentTarget.value)} 
        className="border p-2 rounded" 
      />
      <input 
        type="password" 
        placeholder="API Key" 
        value={key} onChange={e => setKey(e.currentTarget.value)} 
        className="border p-2 rounded" 
      />
      <button onClick={save} className="bg-green-600 text-white p-2 rounded font-bold">Test & Save</button>
      {msg && <p>{msg}</p>}
    </div>
  );
}