import { useState } from "preact/hooks";
import type { PaymentMethod } from "../../shared/types";
import { api } from "../api";
import { t } from "../i18n";
import { back } from "../router";
import { haptic } from "../tg";
import {
  BackNav, BottomButtons, ErrorState, Field, List, Notice, Row, Screen, Section, SkeletonList, errText, toast, useAsync,
} from "../ui";

export function ManualPay() {
  const res = useAsync(() => api<{ methods: PaymentMethod[] }>("/pay/methods"), []);
  const [sel, setSel] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!sel || busy) return;
    const n = Number(amount);
    if (!n || n < sel.min_amount || n > sel.max_amount) { setErr(`Enter ${sel.min_amount}–${sel.max_amount} ${sel.currency}`); return; }
    if (utr.trim().length < 4) { setErr("Enter the transaction ID / UTR"); return; }
    setBusy(true);
    setErr(null);
    try {
      await api("/pay/submit", { method: "POST", body: { method_id: sel.id, amount: n, utr: utr.trim() } });
      haptic.success();
      toast("Payment submitted", "ok");
      back("/wallet");
    } catch (e) {
      toast(errText(e), "error");
      setBusy(false);
    }
  };

  return (
    <>
      <BackNav to="/wallet" />
      <Screen bottom="native" overlay={<BottomButtons main={sel ? { text: "Submit payment", onClick: submit, progress: busy, disabled: !amount || !utr } : null} secondary={{ text: t("common.back"), onClick: () => back("/wallet") }} />}>
        <h1 class="t-title1">Manual payment</h1>
        <p class="sub">Pay with UPI or bank transfer, then submit your transaction ID. An admin approves it.</p>
        {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !res.data ? <SkeletonList rows={3} lead="none" /> : !res.data.methods.length ? <Notice tone="warn">No manual methods are enabled right now.</Notice> : (
          <>
            <Section header="Choose a method">
              <List stagger>
                {res.data.methods.map((m) => (
                  <Row key={m.id} title={m.name} meta={`${m.min_amount}–${m.max_amount} ${m.currency}${m.description ? ` · ${m.description}` : ""}`} onClick={() => setSel(m)} radio checked={sel?.id === m.id} />
                ))}
              </List>
            </Section>
            {sel ? (
              <>
                {sel.qr_key ? (
                  <div class="card pad" style="display:flex;flex-direction:column;align-items:center;gap:12px">
                    <img src={`/media/qr?id=${sel.id}`} alt={`QR for ${sel.name}`} style="max-width:220px;width:100%;border-radius:12px" />
                    <span class="sub">Scan and pay {sel.currency}</span>
                  </div>
                ) : null}
                <Section header="Your payment">
                  <Field id="amount" lead={sel.currency === "INR" ? "₹" : sel.currency} inputMode="decimal" value={amount} onInput={setAmount} placeholder={`${sel.min_amount}–${sel.max_amount}`} error={err && err.includes(sel.currency) ? err : null} />
                  <Field id="utr" label="Transaction ID / UTR" value={utr} onInput={setUtr} placeholder="e.g. 1234567890" />
                </Section>
                {err ? <Notice tone="error">{err}</Notice> : null}
              </>
            ) : null}
          </>
        )}
      </Screen>
    </>
  );
}