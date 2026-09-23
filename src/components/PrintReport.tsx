"use client";
import { useEffect } from 'react';
export function PrintReport() {
  useEffect(() => {
    let closed: HTMLDetailsElement[] = [];
    const prepare = () => {
      closed = Array.from(document.querySelectorAll<HTMLDetailsElement>('main details:not([open])'));
      closed.forEach(detail => { detail.open = true; });
    };
    const restore = () => { closed.forEach(detail => { detail.open = false; }); closed = []; };
    window.addEventListener('beforeprint', prepare);
    window.addEventListener('afterprint', restore);
    return () => {
      window.removeEventListener('beforeprint', prepare);
      window.removeEventListener('afterprint', restore);
      restore();
    };
  }, []);
  return <button type="button" onClick={() => window.print()} className="min-h-11 rounded-lg border border-white/30 px-4 py-2 print:hidden">Print / save PDF</button>;
}
