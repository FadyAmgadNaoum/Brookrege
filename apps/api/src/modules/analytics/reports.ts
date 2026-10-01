import ExcelJS from "exceljs";
import { toCsv, type Column, type DateRange } from "@brookrege/domain";
import { dashboard, inquiriesReport, propertiesReport, teamReport } from "./analytics.service";

export const REPORTS = ["overview", "properties", "inquiries", "team"] as const;
export type ReportName = (typeof REPORTS)[number];
type Row = Record<string, unknown>;
export interface Table { title: string; columns: Column<Row>[]; rows: Row[] }

const col = (header: string, key: string): Column<Row> => ({ header, value: (r) => r[key] as string | number | null });

/** Each report → one or more tables. The same tables feed CSV, Excel and scheduled emails. */
export async function buildReport(name: ReportName, r: DateRange): Promise<{ tables: Table[]; summary: string }> {
  switch (name) {
    case "overview": {
      const x = await dashboard(r);
      const k = x.kpis;
      const rows = Object.entries(k).map(([metric, v]) => ({ metric, value: v.value, previous: v.previous, change: v.change == null ? null : `${v.change}%` }));
      const daily = x.series.views.map((v, i) => ({ day: v.day, views: v.value, inquiries: x.series.inquiries[i]?.value ?? 0 }));
      return {
        tables: [
          { title: "KPIs", columns: [col("Metric", "metric"), col("Value", "value"), col("Previous period", "previous"), col("Change", "change")], rows },
          { title: "Daily", columns: [col("Day", "day"), col("Listing views", "views"), col("Inquiries", "inquiries")], rows: daily },
        ],
        summary: `Views: ${k.views.value} · Inquiries: ${k.inquiries.value} · Live listings: ${k.liveListings.value}`,
      };
    }
    case "properties": {
      const x = await propertiesReport(r);
      return {
        tables: [
          { title: "Listings", columns: [col("ID", "id"), col("Title", "title"), col("Type", "type"), col("Status", "status"), col("Price (EGP)", "price"), col("Views", "views"), col("Inquiries", "inquiries"), col("Inquiries per 100 views", "conversionRate")], rows: x.listings },
          { title: "Median asking price", columns: [col("Region", "region"), col("Type", "type"), col("Live listings", "live"), col("Median price (EGP)", "medianPrice")], rows: x.byRegion },
        ],
        summary: `${x.listings.length} listings analysed.`,
      };
    }
    case "inquiries": {
      const x = await inquiriesReport(r);
      const rows = x.rows.map((i) => ({ date: i.createdAt.toISOString().slice(0, 16).replace("T", " "), name: i.name, phone: i.phone, property: i.property?.title ?? "", status: i.status, responseHours: i.responseHours }));
      return {
        tables: [{ title: "Inquiries", columns: [col("Date (UTC)", "date"), col("Name", "name"), col("Phone", "phone"), col("Property", "property"), col("Status", "status"), col("Hours to first response", "responseHours")], rows }],
        summary: `${rows.length} inquiries · median first response ${x.medianResponseHours ?? "—"} h`,
      };
    }
    case "team": {
      const x = await teamReport(r);
      return {
        tables: [{ title: "Team activity", columns: [col("Name", "name"), col("Role", "role"), col("Sign-ins", "logins"), col("Listing changes", "listingChanges"), col("Lead updates", "leadUpdates"), col("Last active", "lastActive")], rows: x.team }],
        summary: `${x.team.length} team members.`,
      };
    }
  }
}

/** CSV holds one table (the report's main one); Excel gets every table as its own sheet. */
export function toCsvFile(tables: Table[]) {
  const t = tables[0]!;
  return Buffer.from(toCsv(t.rows, t.columns), "utf8");
}

export async function toXlsxFile(tables: Table[], title: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Brookrege";
  wb.title = title;
  for (const t of tables) {
    const ws = wb.addWorksheet(t.title.slice(0, 31));
    ws.columns = t.columns.map((c) => ({ header: c.header, width: Math.max(12, Math.min(48, c.header.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of t.rows) ws.addRow(t.columns.map((c) => { const v = c.value(r); return v instanceof Date ? v : v ?? null; }));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
