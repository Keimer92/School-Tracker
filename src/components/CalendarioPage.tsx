import { emit } from "@tauri-apps/api/event";
import "../App.css";

const todayStr = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

export function CalendarioPage() {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val) {
      sessionStorage.setItem("selectedDate", val);
      emit("date-selected", { date: val });
    }
  };

  return (
    <div lang="es-ES" style={{ padding: "0 16px", display: "flex", justifyContent: "center" }}>
      <input
        type="date"
        lang="es-ES"
        defaultValue={todayStr}
        onChange={handleChange}
        style={{
          width: "100%",
          maxWidth: "300px",
          padding: "8px 12px",
          background: "rgba(30, 41, 59, 0.8)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "8px",
          color: "#e2e8f0",
          fontSize: "0.9rem",
          fontFamily: "Outfit, system-ui, sans-serif",
          outline: "none",
        }}
      />
    </div>
  );
}
