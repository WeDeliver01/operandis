export function Stack({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-16 pt-12 border-t hairline not-prose">
      <h3 className="font-serif text-[22px] font-medium text-ink mb-6">Technical Stack</h3>
      <div className="text-[15px] text-muted leading-relaxed ul-reset">
        {children}
      </div>
    </div>
  );
}
