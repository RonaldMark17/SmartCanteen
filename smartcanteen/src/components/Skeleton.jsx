function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function Skeleton({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={joinClasses(
        'animate-pulse rounded-xl bg-slate-200/80',
        className
      )}
    />
  );
}

export function SkeletonText({ lines = ['h-3 w-full', 'h-3 w-4/5'], className = '' }) {
  return (
    <div className={joinClasses('space-y-2', className)}>
      {lines.map((width, index) => (
        <Skeleton key={`${width}-${index}`} className={width} />
      ))}
    </div>
  );
}
