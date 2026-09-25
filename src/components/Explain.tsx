import type { ReactNode } from 'react';

/** Collapsed-by-default explanation, with the same ▾ disclosure marker as the rest of the app. */
export function Explain({ children, label = 'What am I looking at?' }: { children: ReactNode; label?: string }) {
  return (
    <details className="mt-1 [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden">
      <summary
        className="inline-flex h-8 cursor-pointer items-center rounded px-1.5 text-xs"
        style={{ color: 'var(--text-dim)' }}
      >
        {label} &#9662;
      </summary>
      <div className="mt-1 text-xs" style={{ color: 'var(--text-dim)' }}>
        {children}
      </div>
    </details>
  );
}
