import { useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";

interface ProductTileProps {
  slug: string;
  name: string;
  oneLiner: string;
  image: string;
  logo?: string;
  site?: string;
}

export function ProductTile({ slug, name, oneLiner, image, logo, site }: ProductTileProps) {
  const [imgError, setImgError] = useState(false);
  const [logoError, setLogoError] = useState(false);

  return (
    <div className="block group relative">
      <Link href={`/products/${slug}`} className="block">
        <div className="bg-white rounded-sm overflow-hidden mb-6 transition-all duration-300 group-hover:shadow-ambient border hairline relative">
          {!imgError ? (
            <img
              src={image}
              alt={name}
              className="block w-full h-auto transition-transform duration-700 group-hover:scale-[1.02]"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full aspect-[16/10] flex flex-col items-center justify-center bg-gray-50/50 p-6 text-center">
              <span className="font-serif text-[24px] text-ink/40 font-medium">{name}</span>
            </div>
          )}
          {site && (
            <div className="absolute top-3 right-3 bg-paper/95 backdrop-blur-sm text-ink text-[11px] font-medium uppercase tracking-wider px-2.5 py-1 rounded-sm border hairline flex items-center gap-1">
              Live
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mb-2">
          {logo && !logoError && (
            <img
              src={logo}
              alt=""
              className="h-6 w-6 object-contain flex-shrink-0"
              onError={() => setLogoError(true)}
            />
          )}
          <h3 className="font-serif text-[22px] font-medium text-ink transition-colors group-hover:text-accent">{name}</h3>
        </div>
        <p className="text-[15px] text-muted leading-relaxed line-clamp-2">{oneLiner}</p>
      </Link>
      {site && (
        <a
          href={site}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-3 text-[13px] font-medium text-ink hover:text-accent transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          Visit {site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          <ArrowUpRight size={14} strokeWidth={2} />
        </a>
      )}
    </div>
  );
}
