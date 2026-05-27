import { formatNumber } from '../lib/format.js';

const TONE_CLASSES = {
  default: 'border-slate-200 dark:border-slate-700',
  success: 'border-emerald-200 dark:border-emerald-700/50',
  warning: 'border-amber-200 dark:border-amber-700/50',
  danger:  'border-red-200 dark:border-red-700/50',
};

const TONE_LABELS = {
  default: 'text-slate-500',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger:  'text-red-600 dark:text-red-400',
};

export function StatCard({ label, value, tone = 'default', hint }) {
  return (
    <div className={`bg-white dark:bg-slate-800 border ${TONE_CLASSES[tone]} rounded-lg p-5`}>
      <div className={`text-xs uppercase tracking-widest font-medium ${TONE_LABELS[tone]}`}>
        {label}
      </div>
      <div className="text-3xl font-semibold mt-2 tabular-nums">
        {typeof value === 'number' ? formatNumber(value) : value}
      </div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}
