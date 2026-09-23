"use client";
export function PrintReport() {
  return <button type="button" onClick={() => window.print()} className="min-h-11 rounded-lg border border-white/30 px-4 py-2 print:hidden">Print / save PDF</button>;
}
