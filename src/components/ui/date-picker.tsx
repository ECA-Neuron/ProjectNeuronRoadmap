"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIso(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

interface DatePickerProps {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  className,
  onKeyDown,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const parsed = parseIso(value);
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth());

  useEffect(() => {
    if (open && parsed) {
      setViewYear(parsed.getFullYear());
      setViewMonth(parsed.getMonth());
    }
  }, [open, parsed]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) { setViewYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) { setViewYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const selectDay = useCallback((day: number) => {
    onChange(toIso(new Date(viewYear, viewMonth, day)));
    setOpen(false);
  }, [viewYear, viewMonth, onChange]);

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const today = new Date();
  const todayIso = toIso(today);

  const displayText = parsed
    ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full h-7 text-left text-[11px] bg-background text-foreground border border-border rounded px-2 flex items-center gap-1.5",
          "focus:outline-none focus:ring-1 focus:ring-blue-400",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          !displayText && "text-muted-foreground",
          className,
        )}
      >
        <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="truncate">{displayText || placeholder}</span>
        {value && (
          <span
            role="button"
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
          >
            ×
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-[200] mt-1 w-[252px] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3 animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-xs font-semibold">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0 text-center">
            {DAYS.map((d) => (
              <div key={d} className="text-[10px] font-medium text-muted-foreground py-1">{d}</div>
            ))}

            {Array.from({ length: firstDow }, (_, i) => (
              <div key={`pad-${i}`} />
            ))}

            {Array.from({ length: totalDays }, (_, i) => {
              const day = i + 1;
              const iso = toIso(new Date(viewYear, viewMonth, day));
              const isSelected = value === iso;
              const isToday = iso === todayIso;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={cn(
                    "w-8 h-8 text-[11px] rounded-md transition-colors",
                    isSelected
                      ? "bg-blue-600 text-white font-semibold"
                      : isToday
                        ? "bg-accent font-semibold text-foreground"
                        : "hover:bg-accent text-foreground",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-border flex justify-between">
            <button
              type="button"
              onClick={() => { onChange(todayIso); setOpen(false); }}
              className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
