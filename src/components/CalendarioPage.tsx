import { useState, useEffect } from "react";
import { emit } from "@tauri-apps/api/event";
import "../App.css";

export function CalendarioPage() {
  const [isMobile, setIsMobile] = useState(false);
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth());
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const months = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  const daysOfWeek = ["L", "M", "X", "J", "V", "S", "D"];

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1;
  };

  const generateCalendarDays = () => {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDay = getFirstDayOfMonth(selectedYear, selectedMonth);
    const daysInPrevMonth = getDaysInMonth(selectedYear, selectedMonth - 1);
    
    const days: { day: number; isCurrentMonth: boolean; dateStr: string }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({ day, isCurrentMonth: false, dateStr });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, isCurrentMonth: true, dateStr });
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, isCurrentMonth: false, dateStr });
    }

    return days;
  };

  const isDateSelected = (dateStr: string) => {
    return selectedDate === dateStr;
  };

  const isRangeStart = (dateStr: string) => {
    return selectedDate === dateStr;
  };

  const isRangeEnd = (dateStr: string) => {
    return selectedDate === dateStr;
  };

  const handleDateClick = (dateStr: string, isCurrentMonth: boolean) => {
    if (!isCurrentMonth) return;
    setSelectedDate(dateStr);
  };

  const goToPrevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  const handleApply = () => {
    if (selectedDate) {
      sessionStorage.setItem("selectedDate", selectedDate);
      emit("date-selected", { date: selectedDate });
    }
  };

  const handleClear = () => {
    setSelectedDate(null);
  };

  const goToToday = () => {
    const today = new Date();
    setSelectedMonth(today.getMonth());
    setSelectedYear(today.getFullYear());
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setSelectedDate(todayStr);
  };

  const calendarDays = generateCalendarDays();

  return (
    <div className="page-container">
      <style>{`
        .custom-calendar {
          --side-padding: 16px;
          --border-radius: 20px;
          --accent-br: 12px;
          width: 100%;
          max-width: 400px;
          margin: 0 auto;
          font-family: "Nunito", sans-serif;
        }
        .custom-calendar select {
          background-color: rgba(15, 23, 42, 0.9);
          color: #e2e8f0;
          padding: 12px 16px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          outline: none;
          font-size: 0.9rem;
        }
        .custom-calendar select option {
          background-color: #0f172a;
          color: #e2e8f0;
          padding: 8px;
        }
        .custom-calendar__opts, .custom-calendar__buttons {
          background-color: rgba(30, 41, 59, 0.8);
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 12px;
          border-radius: var(--border-radius);
        }
        .custom-calendar__opts {
          padding: 16px var(--side-padding);
          border-bottom-left-radius: var(--border-radius);
          border-bottom-right-radius: var(--border-radius);
        }
        .custom-calendar__body {
          background: linear-gradient(to bottom, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8));
          border-radius: var(--border-radius);
          overflow: hidden;
        }
        .custom-calendar__days {
          background-color: rgba(30, 41, 59, 0.9);
          padding: 12px var(--side-padding) 8px;
          display: grid;
          grid-template-columns: repeat(7, 1fr);
        }
        .custom-calendar__days > div {
          text-align: center;
          font-weight: 700;
          font-size: 0.8rem;
          color: #64748b;
        }
        .custom-calendar__dates {
          padding: 8px var(--side-padding) 16px;
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
        }
        .custom-calendar__date {
          text-align: center;
          height: 40px;
          line-height: 40px;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          position: relative;
          border-radius: 8px;
          transition: all 0.2s ease;
        }
        .custom-calendar__date::before {
          content: "";
          position: absolute;
          background-color: transparent;
          width: 36px;
          height: 36px;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          border-radius: var(--accent-br);
          transition: background-color 0.3s ease;
        }
        .custom-calendar__date:not(.custom-calendar__date--selected):not(.custom-calendar__date--grey):hover::before {
          background-color: rgba(255, 255, 255, 0.1);
        }
        .custom-calendar__date--grey {
          color: #475569;
          cursor: not-allowed;
        }
        .custom-calendar__date--selected {
          color: #10b981;
        }
        .custom-calendar__date--selected::before {
          background-color: rgba(16, 185, 129, 0.2);
        }
        .custom-calendar__date--first-date::before {
          border-top-left-radius: var(--accent-br);
          border-bottom-left-radius: var(--accent-br);
        }
        .custom-calendar__date--last-date::before {
          border-top-right-radius: var(--accent-br);
          border-bottom-right-radius: var(--accent-br);
        }
        .custom-calendar__date--range-start::after {
          content: "";
          position: absolute;
          bottom: 2px;
          border-radius: 10px;
          left: 50%;
          transform: translateX(-50%);
          background-color: #10b981;
          width: 8px;
          height: 3px;
        }
        .custom-calendar__date--range-end {
          color: #fff;
        }
        .custom-calendar__date--range-end::before {
          box-shadow: 0 8px 15px -3px rgba(16, 185, 129, 0.3);
          background-color: #10b981;
          border-radius: var(--accent-br);
          z-index: 1;
        }
        .custom-calendar__date--range-end::after {
          content: "";
          position: absolute;
          height: 36px;
          background-color: rgba(16, 185, 129, 0.15);
          width: 40px;
          top: 50%;
          right: 50%;
          transform: translateY(-50%);
        }
        .custom-calendar__date span {
          position: relative;
          z-index: 1;
        }
        .custom-calendar__buttons {
          padding: 12px var(--side-padding) 16px;
          margin-top: 12px;
          border-radius: var(--border-radius);
        }
        .custom-calendar__button {
          cursor: pointer;
          font-weight: 700;
          border-radius: 12px;
          border: none;
          padding: 12px 16px;
          font-size: 0.9rem;
          transition: all 0.3s ease;
        }
        .custom-calendar__button--grey {
          background-color: rgba(255, 255, 255, 0.1);
          color: #94a3b8;
        }
        .custom-calendar__button--grey:hover {
          background-color: rgba(255, 255, 255, 0.15);
        }
        .custom-calendar__button--primary {
          background-color: #10b981;
          color: #fff;
        }
        .custom-calendar__button--primary:hover {
          box-shadow: 0 10px 20px -8px rgba(16, 185, 129, 0.4);
          transform: translateY(-2px);
        }
        .custom-calendar__button--primary:active {
          transform: translateY(0);
        }
        .selected-info {
          text-align: center;
          color: #e2e8f0;
          font-size: 0.9rem;
          margin-top: 12px;
          padding: 8px;
          background: rgba(16, 185, 129, 0.1);
          border-radius: 8px;
        }
      `}</style>
      
      <div className="category-grid" style={{ display: 'block', padding: '1rem' }}>
        <div className="custom-calendar">
          <div className="custom-calendar__opts">
            <button 
              onClick={goToToday}
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid #10b981',
                borderRadius: '10px',
                color: '#10b981',
                padding: '8px 12px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              📍 Hoy
            </button>
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {months.map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
          </div>
          <div className="custom-calendar__opts" style={{ marginTop: '8px' }}>
            <select 
              value={selectedYear} 
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              style={{ gridColumn: '1 / -1' }}
            >
              {[currentDate.getFullYear() - 1, currentDate.getFullYear(), currentDate.getFullYear() + 1, currentDate.getFullYear() + 2].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div className="custom-calendar__body">
            <div className="custom-calendar__days">
              {daysOfWeek.map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
            <div className="custom-calendar__dates">
              {calendarDays.map((day, index) => {
                const isSelected = isDateSelected(day.dateStr);
                const isStart = isRangeStart(day.dateStr);
                const isEnd = isRangeEnd(day.dateStr);
                const classes = [
                  !day.isCurrentMonth && 'custom-calendar__date--grey',
                  isSelected && 'custom-calendar__date--selected',
                  isStart && 'custom-calendar__date--first-date',
                  isEnd && 'custom-calendar__date--range-end',
                  isStart && !isEnd && 'custom-calendar__date--range-start'
                ].filter(Boolean).join(' ');
                
                return (
                  <div 
                    key={index}
                    className={`custom-calendar__date ${classes}`}
                    onClick={() => handleDateClick(day.dateStr, day.isCurrentMonth)}
                  >
                    <span>{day.day}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="custom-calendar__buttons">
            <button className="custom-calendar__button custom-calendar__button--grey" onClick={handleClear}>
              🗑️ Limpiar
            </button>
            <button className="custom-calendar__button custom-calendar__button--primary" onClick={handleApply}>
              ✓ Aplicar
            </button>
          </div>

          {selectedDate && (
            <div className="selected-info">
              📅 Fecha seleccionada: {new Date(selectedDate + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}