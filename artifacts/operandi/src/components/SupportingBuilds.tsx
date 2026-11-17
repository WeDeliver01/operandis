import { Link } from "wouter";
import { supportingProducts } from "@/content/products";
import { Lock } from "lucide-react";

export function SupportingBuilds() {
  return (
    <div className="divide-y hairline border-y hairline">
      {supportingProducts.map((product) => (
        <Link
          key={product.slug}
          href={`/products/${product.slug}`}
          className="group flex flex-col md:flex-row md:items-center gap-6 py-8 hover:bg-paper-2/40 transition-colors -mx-4 px-4 rounded-sm"
        >
          <div className="flex-shrink-0 w-20 h-20 bg-white border hairline rounded-sm flex items-center justify-center overflow-hidden">
            {product.logo ? (
              <img
                src={product.logo}
                alt={`${product.name} logo`}
                className="max-w-[70%] max-h-[70%] object-contain"
              />
            ) : (
              <span className="font-serif text-[20px] font-medium text-ink">
                {product.name.charAt(0)}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="font-serif text-[22px] md:text-[24px] font-medium text-ink group-hover:text-accent transition-colors">
                {product.name}
              </h3>
              {!product.site && (
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-faint border hairline px-2 py-0.5 rounded-sm">
                  <Lock size={11} /> Internal
                </span>
              )}
            </div>
            <p className="font-sans text-[15px] text-muted mt-2 leading-relaxed max-w-[640px]">
              {product.oneLiner}
            </p>
          </div>

          <div className="md:flex-shrink-0">
            <span className="inline-flex items-center text-[14px] font-medium text-ink group-hover:text-accent group-hover:underline transition-colors">
              Read the build &rarr;
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
