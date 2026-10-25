// Admin > Settings: replace the Panel API URL & Key, and manage who is an admin. English only.
import { useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { Icon } from "../icons";
import { meStore } from "../store";
import { confirmDialog } from "../tg";
import { Chip, Field, List, Notice, Row, Section, toast } from "../ui";
import { Kv, fail } from "./AdminRoutes";

export interface Owners {
  env: number[];
  added: number[];
}

export function PanelConfigSection({ hint, onSaved }: { hint: string | null; onSaved: (hint: string | null) => void }) {
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (busy || !base.trim() || !key.trim()) return;
    
    if (hint && !(await confirmDialog("Are you sure you want to change the API URL and Key? Make sure your new panel uses the standard SMM API format.", "Save", "Cancel"))) return;
    
    setBusy(true);
    setErr(null);
    try {
      // Calls the new route we set up in worker/index.ts
      const r = await api<{ ok: boolean; message?: string; error?: string }>("/admin/panel/config", { 
        method: "POST", 
        body: { base: base.trim(), key: key.trim() } 
      });
      
      setBase("");
      setKey("");
      // Show the last 4 characters of the new key
      onSaved(`****${key.slice(-4)}`);
      toast("Panel connected and saved!", "ok");
    } catch (e: any) {
      if (e instanceof ApiError) {
        setErr(e.message || "Failed to connect to the panel. Check the URL and Key.");
      } else {
        fail(e);
      }
    }
    setBusy(false);
  };

  return (
    <Section
      header="SMM Panel Connection"
      footer="Enter your reseller panel's API URL and API Key. The system will test the connection before saving. Once saved, the bot will automatically sync categories and services from this panel."
    >
      <dl class="card">
        <Kv label="Current Key">
          <span class="mono">{hint ?? "missing"}</span>
        </Kv>
      </dl>
      
      <Field
        id="panel-base"
        label="API URL (Base URL)"
        dir="ltr"
        value={base}
        onInput={(v) => (setBase(v), setErr(null))}
        placeholder="https://your-panel.com/api/v2"
        error={err && !base ? "URL is required" : null}
      />

      <Field
        id="panel-key"
        label="API Key"
        type="password"
        dir="ltr"
        value={key}
        onInput={(v) => (setKey(v), setErr(null))}
        placeholder="Paste your new API key here"
        error={err && base ? err : null}
        enterKeyHint="go"
      />

      <button type="button" class="btn sm soft inline" disabled={busy || !base.trim() || !key.trim()} aria-busy={busy ? "true" : undefined} onClick={save}>
        {busy ? <span class="spin" aria-hidden="true" /> : null}
        Test & Save Connection
      </button>
    </Section>
  );
}

export function AdminsSection({ owners, onChanged }: { owners: Owners; onChanged: (o: Owners) => void }) {
  const myId = meStore.get()?.id;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const write = async (added: number[]) => {
    setBusy(true);
    try {
      await api("/admin/owners", { method: "PUT", body: { added } });
      onChanged({ ...owners, added });
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.code === "LAST_OWNER" || e.code === "INVALID_VALUE")) toast("You can't remove the last admin.", "error");
      else fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  
  const add = async () => {
    const id = Number(value.trim());
    if (!/^\d{5,15}$/.test(value.trim())) return void setErr("A Telegram ID is a number of 5 to 15 digits. People can find theirs with @userinfobot.");
    if (owners.env.includes(id) || owners.added.includes(id)) return void setErr("That person is already an admin.");
    setErr(null);
    if (await write([...owners.added, id])) {
      setValue("");
      toast("Admin added", "ok");
    }
  };
  
  const remove = async (id: number) => {
    const self = id === myId;
    const ok = await confirmDialog(self ? "Remove yourself as an admin? You will lose access to this panel." : `Remove ${id} as an admin?`, "Remove", "Cancel", true);
    if (ok && (await write(owners.added.filter((x) => x !== id)))) toast("Admin removed", "ok");
  };

  return (
    <Section header="Admins" footer="Admins can change prices, branding and settings. Admins set on your host (OWNER_IDS) can only be changed there.">
      {owners.env.length || owners.added.length ? (
        <List>
          {owners.env.map((id) => (
            <Row key={`e${id}`} title={<span class="num">{id}</span>} meta={id === myId ? "You · set on the host" : "Set on the host"} chevron={false} />
          ))}
          {owners.added.map((id) => (
            <Row
              key={`a${id}`}
              title={<span class="num">{id}</span>}
              meta={id === myId ? "You" : "Added here"}
              control={
                <Chip label={`Remove admin ${id}`} disabled={busy} onClick={() => remove(id)}>
                  <Icon name="close" size={14} stroke={2.4} />
                  Remove
                </Chip>
              }
            />
          ))}
        </List>
      ) : (
        <Notice tone="warn">No admins found.</Notice>
      )}
      <Field
        id="admin-add"
        label="Add an admin"
        inputMode="numeric"
        dir="ltr"
        lead="users"
        value={value}
        onInput={(v) => (setValue(v.replace(/\D/g, "")), setErr(null))}
        placeholder="Telegram ID, e.g. 123456789"
        error={err}
        enterKeyHint="done"
      />
      <button type="button" class="btn sm soft inline" disabled={busy || !value.trim()} onClick={add}>
        Add admin
      </button>
    </Section>
  );
}