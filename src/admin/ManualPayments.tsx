import { useState } from "preact/hooks";
import type { ManualPayment, PaymentMethod } from "../../shared/types";
import { api } from "../api";
import { dateTime, num } from "../format";
import { Page, fail } from "./AdminRoutes";
import {
  Chip, EmptyState, ErrorState, Field, List, Notice, Num, Row, Section, Seg, Sheet, SkeletonList, Switch, toast, useAsync,
} from "../ui";
import { haptic } from "../tg";

type Status = "pending" | "accepted" | "declined";

export function ManualPayments() {
  const [view, setView] = useState<"queue" | "methods">("queue");
  return (
    <Page back="/admin" title="Manual payments" sub="UPI / bank transfers and methods">
      <Seg label="View" value={view} onChange={setView} options={[["queue", "Queue"], ["methods", "Methods"]]} />
      {view === "queue" ? <Queue /> : <Methods />}
    </Page>
  );
}

function Queue() {
  const [status, setStatus] = useState<Status>("pending");
  const [sel, setSel] = useState<ManualPayment | null>(null);
  const res = useAsync(() => api<{ payments: ManualPayment[] }>(`/pay/admin/list?status=${status}`), [status]);
  return (
    <>
      <Seg label="Status" value={status} onChange={setStatus} options={[["pending", "Pending"], ["accepted", "Accepted"], ["declined", "Declined"]]} />
      {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !res.data ? <SkeletonList rows={5} lead="none" /> : !res.data.payments.length ? (
        <EmptyState compact art="wallet" title={`No ${status} payments`} body={status === "pending" ? "New submissions appear here." : undefined} />
      ) : (
        <List stagger>
          {res.data.payments.map((p) => (
            <Row key={p.id} icon="wallet" plate="var(--lime)" title={<><bdi>{p.first_name ?? `User ${p.user_id}`}</bdi>{p.username ? <span class="hint"> @{p.username}</span> : null}</>} meta={<><Num>{num(p.amount)}</Num> {p.currency} · {p.method_name} · UTR <span class="mono">{p.utr}</span> · {dateTime(p.created_at)}</>} value={<span class={`status ${p.status === "pending" ? "st-pending" : p.status === "accepted" ? "st-done" : "st-cancel"}`}>{p.status}</span>} onClick={() => setSel(p)} />
          ))}
        </List>
      )}
      {sel ? <DecideSheet p={sel} onClose={() => setSel(null)} onDecided={() => { setSel(null); res.reload(); }} /> : null}
    </>
  );
}

function DecideSheet({ p, onClose, onDecided }: { p: ManualPayment; onClose: () => void; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const act = async (path: string, body?: unknown) => {
    if (busy) return;
    haptic.press();
    setBusy(true);
    try {
      await api(`/pay/admin/${p.id}/${path}`, { method: "POST", body });
      toast("Done", "ok");
      onDecided();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Payment #${p.id}`} onClose={onClose} footer={p.status === "pending" ? (
      <>
        <button type="button" class="btn soft" disabled={busy} onClick={() => act("decline")}>Decline</button>
        <button type="button" class="btn" disabled={busy} onClick={() => act("accept")}>Accept</button>
      </>
    ) : undefined}>
      <dl class="card">
        <div class="kv"><dt>User</dt><dd>{p.first_name ?? p.user_id}{p.username ? ` @${p.username}` : ""}</dd></div>
        <div class="kv"><dt>Amount</dt><dd><Num>{num(p.amount)}</Num> {p.currency}</dd></div>
        <div class="kv"><dt>Method</dt><dd>{p.method_name}</dd></div>
        <div class="kv"><dt>UTR</dt><dd class="mono">{p.utr}</dd></div>
        <div class="kv"><dt>Submitted</dt><dd>{dateTime(p.created_at)}</dd></div>
        <div class="kv"><dt>Status</dt><dd>{p.status}</dd></div>
      </dl>
      {p.status === "pending" ? (
        <Section header="Custom credit" footer="Override the amount when accepting.">
          <Field id="custom-amount" lead="$" inputMode="decimal" value={custom} onInput={setCustom} placeholder="0.00" />
          <button type="button" class="btn sm soft inline" disabled={busy || !custom.trim()} onClick={() => act("custom", { custom_micro_usd: Math.round(Number(custom) * 1_000_000) })}>Accept with custom amount</button>
        </Section>
      ) : null}
    </Sheet>
  );
}

function Methods() {
  const res = useAsync(() => api<{ methods: PaymentMethod[] }>("/pay/admin/methods"), []);
  const [sel, setSel] = useState<PaymentMethod | "new" | null>(null);
  return (
    <>
      {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !res.data ? <SkeletonList rows={4} lead="none" /> : (
        <>
          {res.data.methods.length ? (
            <List stagger>
              {res.data.methods.map((m) => (
                <Row key={m.id} icon="wallet" plate="var(--lime)" title={m.name} meta={<>{m.currency} · <Num>{num(m.min_amount)}</Num>–<Num>{num(m.max_amount)}</Num> · {m.auto_approve ? "auto" : "manual"} · {m.enabled ? "on" : "off"}</>} onClick={() => setSel(m)} />
              ))}
            </List>
          ) : <EmptyState compact art="wallet" title="No methods yet" body="Add one to accept manual payments." />}
          <button type="button" class="btn soft" onClick={() => setSel("new")}>Add method</button>
        </>
      )}
      {sel ? <MethodSheet m={sel === "new" ? null : sel} onClose={() => setSel(null)} onSaved={() => { setSel(null); res.reload(); }} /> : null}
    </>
  );
}

function MethodSheet({ m, onClose, onSaved }: { m: PaymentMethod | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(m?.name ?? "");
  const [currency, setCurrency] = useState(m?.currency ?? "INR");
  const [minAmount, setMinAmount] = useState(String(m?.min_amount ?? 1));
  const [maxAmount, setMaxAmount] = useState(String(m?.max_amount ?? 100000));
  const [description, setDescription] = useState(m?.description ?? "");
  const [autoApprove, setAutoApprove] = useState(!!m?.auto_approve);
  const [enabled, setEnabled] = useState(m?.enabled !== 0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const save = async () => {
    if (busy) return;
    haptic.press();
    setBusy(true);
    try {
      await api("/pay/admin/methods", { method: "POST", body: {
        id: m?.id,
        name: name.trim(),
        currency,
        min_amount: Number(minAmount) || 1,
        max_amount: Number(maxAmount) || 100000,
        description: description.trim(),
        auto_approve: autoApprove ? 1 : 0,
        enabled: enabled ? 1 : 0,
        qr_key: m?.qr_key ?? null,
      }});
      toast(m ? "Method saved" : "Method added", "ok");
      onSaved();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  const uploadQr = async (file: File | undefined) => {
    if (!file || !m?.id) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast("Use PNG, JPEG or WebP", "error"); return; }
    if (file.size > 700_000) { toast("Max 700 KB", "error"); return; }
    setUploading(true);
    try {
      await api(`/pay/admin/methods/${m.id}/qr`, { method: "POST", body: file });
      toast("QR uploaded", "ok");
      onSaved();
    } catch (e) {
      fail(e);
    }
    setUploading(false);
  };

  return (
    <Sheet title={m ? "Edit method" : "New method"} onClose={onClose} footer={<button type="button" class="btn" disabled={busy || !name.trim()} onClick={save}>{busy ? <span class="spin" /> : null}Save</button>}>
      <Field id="m-name" label="Name" value={name} onInput={setName} placeholder="UPI / Bank transfer" />
      <Field id="m-currency" label="Currency" value={currency} onInput={setCurrency} placeholder="INR" />
      <Field id="m-min" label="Min amount" inputMode="numeric" value={minAmount} onInput={setMinAmount} />
      <Field id="m-max" label="Max amount" inputMode="numeric" value={maxAmount} onInput={setMaxAmount} />
      <Field id="m-desc" label="Description" multiline rows={3} value={description} onInput={setDescription} placeholder="Pay to UPI ID:…" />
      <List>
        <Row toggle={{ on: autoApprove, onChange: setAutoApprove }} title="Auto-approve" meta="Credit balance immediately when users submit" />
        <Row toggle={{ on: enabled, onChange: setEnabled }} title="Enabled" meta="Show to customers" />
      </List>
      {m ? (
        <Section header="QR code" footer="Optional. PNG, JPEG or WebP, up to 700 KB.">
          {m.qr_key ? <img src={`/media/qr?id=${m.id}`} alt="QR" style="max-width:180px;border-radius:12px;display:block;margin:0 auto" /> : <Notice tone="plain">No QR uploaded.</Notice>}
          <input type="file" id="qr-file" class="sr" accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadQr(e.currentTarget.files?.[0])} />
          <label class="btn sm soft inline" for="qr-file">{uploading ? "Uploading…" : m.qr_key ? "Replace QR" : "Upload QR"}</label>
        </Section>
      ) : null}
    </Sheet>
  );
                  }
