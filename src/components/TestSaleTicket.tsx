import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Printer } from "lucide-react";
import beeCleanLogo from "@/assets/bee-clean-logo.png";

export const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};

export const saleFolio = (id: string) => id.substring(0, 8).toUpperCase();

const money = (n: unknown) =>
  `$${Number(n ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Single source of ticket styles: used by the on-screen preview and the print window.
// Printable width on 58 mm paper is ~52 mm after the 3 mm side padding.
const TICKET_CSS = `
  .ticket-thermal { width: 58mm; padding: 3mm 3mm 5mm; font-family: Arial, Helvetica, sans-serif; font-size: 9px; line-height: 1.28; color: #000; background: #fff; box-sizing: border-box; }
  .ticket-thermal * { box-sizing: border-box; }
  .ticket-thermal .ticket-logo { display: block; width: 42mm; max-height: 24mm; object-fit: contain; margin: 0 auto 1.5mm; filter: grayscale(1) contrast(1.45); }
  .ticket-thermal .ticket-center { text-align: center; }
  .ticket-thermal .ticket-kicker { margin-bottom: 1mm; font-size: 7px; font-weight: 700; text-transform: uppercase; }
  .ticket-thermal .ticket-meta div { display: flex; justify-content: space-between; gap: 2mm; }
  .ticket-thermal .ticket-label { font-weight: 800; }
  .ticket-thermal .ticket-rule { border: 0; border-top: .35mm dashed #000; margin: 2mm 0; }
  .ticket-thermal table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .ticket-thermal .ticket-items th { padding: 0 0 1mm; border-bottom: .3mm solid #000; font-size: 7.5px; font-weight: 800; text-align: right; white-space: nowrap; }
  .ticket-thermal .ticket-items td { padding: 1.2mm 0 0; vertical-align: top; text-align: right; font-size: 8px; white-space: nowrap; }
  .ticket-thermal .ticket-items th + th, .ticket-thermal .ticket-items td + td { padding-left: 1.2mm; }
  .ticket-thermal .ticket-items th:first-child, .ticket-thermal .ticket-items td:first-child { text-align: left; white-space: normal; word-break: break-word; }
  .ticket-thermal .ticket-product { font-weight: 800; }
  .ticket-thermal .ticket-presentation { display: block; font-size: 7px; font-weight: 400; }
  .ticket-thermal .ticket-summary td { padding-top: .7mm; text-align: right; }
  .ticket-thermal .ticket-summary td:first-child { text-align: left; }
  .ticket-thermal .ticket-total td { border-top: .45mm solid #000; padding-top: 1.5mm; font-size: 15px; font-weight: 900; }
  .ticket-thermal .ticket-status { margin: 2mm 0; padding: 1.5mm; border: .4mm solid #000; font-weight: 900; text-align: center; }
  .ticket-thermal .ticket-thanks { margin-top: 2.5mm; font-size: 10px; font-weight: 800; text-align: center; }
  .ticket-thermal .ticket-footer { margin-top: 1mm; font-size: 7px; text-align: center; }
`;

function printTicket() {
  const el = document.getElementById("ticket-58mm");
  if (!el) return;
  const w = window.open("", "_blank", "width=420,height=760");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Ticket</title><base href="${window.location.origin}/">
    <style>
      @page { size: 58mm auto; margin: 0; }
      html, body { width: 58mm; margin: 0; padding: 0; background: #fff; }
      ${TICKET_CSS}
    </style></head><body>${el.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  // Wait for the logo so it is not missing from the printout.
  const images = Array.from(w.document.images);
  Promise.all(images.map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })))
    .then(() => { w.print(); w.close(); });
}

export function TestSaleTicketDialog({ saleId, open, onOpenChange }: { saleId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useQuery({
    enabled: !!saleId && open,
    queryKey: ["test_sale_ticket", saleId],
    queryFn: async () => {
      if (!saleId) throw new Error("Falta el folio de la venta");
      const [s, items, biz] = await Promise.all([
        supabase.from("test_sales").select("*, customers(name,address,city,phone)").eq("id", saleId).single(),
        supabase.from("test_sale_items").select("*").eq("sale_id", saleId).order("created_at"),
        supabase.from("settings").select("*").limit(1).maybeSingle(),
      ]);
      return { sale: s.data, items: items.data ?? [], biz: biz.data };
    },
  });

  const sale = data?.sale;
  const items = data?.items ?? [];
  const biz = data?.biz;
  const customer = sale?.customers;
  const saleDate = sale ? new Date(sale.created_at) : null;
  const pending = sale ? Number(sale.total) - Number(sale.amount_paid ?? 0) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Ticket de venta</DialogTitle></DialogHeader>
        <style>{TICKET_CSS}</style>
        {sale && (
          <div className="flex flex-col items-center">
            <div id="ticket-58mm" className="ticket-thermal border">
              <img className="ticket-logo" src={beeCleanLogo} alt="Bee Clean" />
              <div className="ticket-center ticket-kicker">Productos y servicios de limpieza</div>
              <div className="ticket-center">{biz?.address || "Av. Aquiles Serdán 888, casi esquina con Doroteo Arango, Col. Tabachines 1, Los Mochis, Sin. C.P. 81257"}</div>
              <div className="ticket-center">RFC: NACJ020202R24</div>
              <div className="ticket-center">Tel: {biz?.phone || "668 250 50 34"}</div>

              <hr className="ticket-rule" />
              <div className="ticket-meta">
                <div><span className="ticket-label">FOLIO</span><span>#{saleFolio(sale.id)}</span></div>
                <div><span className="ticket-label">FECHA</span><span>{saleDate?.toLocaleDateString("es-MX")}</span></div>
                <div><span className="ticket-label">HORA</span><span>{saleDate?.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span></div>
              </div>

              <hr className="ticket-rule" />
              <div><span className="ticket-label">CLIENTE: </span>{customer?.name || "Público general"}</div>
              {customer?.address && <div><span className="ticket-label">DIRECCIÓN: </span>{customer.address}{customer.city ? `, ${customer.city}` : ""}</div>}
              {customer?.phone && <div><span className="ticket-label">TELÉFONO: </span>{customer.phone}</div>}
              <div><span className="ticket-label">PAGO: </span>{PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</div>

              <hr className="ticket-rule" />
              <table className="ticket-items">
                <colgroup>
                  <col style={{ width: "36%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "26%" }} />
                </colgroup>
                <thead>
                  <tr><th>PRODUCTO</th><th>CANT.</th><th>PRECIO</th><th>IMPORTE</th></tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={item.id}>
                      <td className="ticket-product">{item.product_name}<span className="ticket-presentation">{item.presentation}</span></td>
                      <td>{Number(item.quantity).toLocaleString("es-MX", { maximumFractionDigits: 2 })}</td>
                      <td>{money(item.unit_price)}</td>
                      <td>{money(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <hr className="ticket-rule" />
              <table className="ticket-summary">
                <tbody>
                  <tr><td>Subtotal</td><td>{money(sale.subtotal)}</td></tr>
                  {Number(sale.discount) > 0 && <tr><td>Descuento</td><td>-{money(sale.discount)}</td></tr>}
                  <tr className="ticket-total"><td>TOTAL</td><td>{money(sale.total)}</td></tr>
                </tbody>
              </table>
              {sale.is_credit && pending > 0 && <div className="ticket-status">PAGO PENDIENTE: {money(pending)}</div>}
              <div className="ticket-thanks">¡Gracias por elegir Bee Clean!</div>
              <div className="ticket-footer">Conserva este ticket para cualquier aclaración.</div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={printTicket} disabled={!sale}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
