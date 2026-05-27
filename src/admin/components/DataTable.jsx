/**
 * Minimal generic table component.
 * Pass `columns` (array of {key, label, render?}) and `rows`.
 */
export function DataTable({ columns, rows, emptyText = 'No rows.', getRowKey }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/60">
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className="text-left font-medium text-slate-500 px-3 py-2 border-b border-slate-200 dark:border-slate-700"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={getRowKey ? getRowKey(row, idx) : idx}
              className="border-b last:border-b-0 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              {columns.map(col => (
                <td key={col.key} className="px-3 py-2 align-top">
                  {col.render ? col.render(row) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
