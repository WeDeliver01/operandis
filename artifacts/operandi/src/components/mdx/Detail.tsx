export function Detail({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50/50 border hairline p-8 rounded-sm my-8 not-prose">
      <ul className="space-y-3 m-0 list-disc pl-5 text-[15px] text-muted marker:text-ink/30">
        {children}
      </ul>
    </div>
  );
}
