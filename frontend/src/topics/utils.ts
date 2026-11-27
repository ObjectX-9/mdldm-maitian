let countFormatter: Intl.NumberFormat | undefined;

export function number(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return (countFormatter ??= new Intl.NumberFormat('zh-CN')).format(value);
}
