export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card px-5 py-8">
      <h2>{title}</h2>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </section>
  );
}
