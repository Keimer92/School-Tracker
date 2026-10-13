import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.TEMP + "\\stp3.db", { readOnly: true });
const all = (s) => db.prepare(s).all(s);

for (const t of ["sync_pending_deletions_nota", "sync_pending_deletions", "nota"]) {
  console.log("=== " + t + " ===");
  console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t)?.sql);
}
console.log("\n=== filas pendientes actuales ===");
console.log("nota:", db.prepare("SELECT COUNT(*) n FROM sync_pending_deletions_nota").get().n);
console.log("otras:", JSON.stringify(db.prepare("SELECT tabla, COUNT(*) n FROM sync_pending_deletions GROUP BY tabla").all()));
db.close();