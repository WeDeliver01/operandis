import { useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Lock } from "lucide-react";
import type { PortfolioSummary } from "@workspace/api-zod";
import { STATUS_LABELS } from "@/lib/queries";
import { trackEvent } from "@/lib/analytics";

interface ProductTileProps {
  slug: string;
  name: string;
  oneLiner: string;
  image: string;
  logo?: string | null;
  site?: string | null;
  statusLabel?: PortfolioSummary["statusLabel"];
}

export function ProductTile({ slug, name, oneLiner, image, logo, site, statusLabel }: ProductTileProps) {
  const [imgError, setImgError] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const status = statusLabel ?? (site ? "live" : "internal_tool");

  return (
    <div className="block group relative">
      <Link href={`/products/${slug}`} className="block" onClick={() => trackEvent("portfolio_project_viewed", { entityType: "portfolio", entityId: slug })}>
        <div className="bg-white rounded-sm overflow-hidden mb-6 transition-all duration-300 group-hover:shadow-ambient border hairline relative aspect-[16/10]">
          {!imgError ? (
            <img src={image} alt={`${name} screenshot`} loading="lazy" className="block w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.02] motion-reduce:transition-none" onError={() => setImgError(true)} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50/50 p-6 text-center">
              <span className="font-serif text-[24px] text-ink/40 font-medium">{name}</span>
            </div>
          )}
          <div className="absolute top-3 right-3 bg-paper/95 backdrop-blur-sm text-ink text-[11px] font-medium uppercase tracking-wider px-2.5 py-1 rounded-sm border hairline flex items-center gap-1.5">
            {status === "internal_tool" && <Lock size={10} aria-hidden />}
            {STATUS_LABELS[status]}
            {status === "live" && <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden />}
          </div>
        </div>
        <div className="flex items-center gap-3 mb-2">
          {logo && !logoError && <img src={logo} alt="" className="h-6 w-6 object-contain flex-shrink-0" onError={() => setLogoError(true)} />}
          <h3 className="font-serif text-[22px] font-medium text-ink transition-colors group-hover:text-accent">{name}</h3>
        </div>
        <p className="text-[15px] text-muted leading-relaxed line-clamp-2">{oneLiner}</p>
      </Link>
      {site && (
        <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-3 text-[13px] font-medium text-ink hover:text-accent transition-colors">
          Visit {site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          <ArrowUpRight size={14} strokeWidth={2} />
        </a>
      )}
    </div>
  );
}

export function PortfolioTile({ p }: { p: PortfolioSummary }) {
  return <ProductTile slug={p.slug} name={p.title} oneLiner={p.shortDescription} image={p.thumbnailUrl ?? ""} logo={p.logoUrl} site={p.externalUrl} statusLabel={p.statusLabel} />;
}
