import { useQuery } from "@tanstack/react-query";
import type { Faq, PackageDetail, PackageSummary, PortfolioDetail, PortfolioSummary, ServiceCategory } from "@workspace/api-zod";
import { get } from "./api";
import { products as staticProducts } from "@/content/products";

/** Static fallback so the public portfolio still renders if the API is unreachable. */
const FALLBACK_PORTFOLIO: PortfolioSummary[] = staticProducts.map((p, i) => ({
  id: p.slug,
  slug: p.slug,
  title: p.name,
  shortDescription: p.oneLiner,
  industry: "",
  projectType: "",
  statusLabel: p.site ? "live" : "internal_tool",
  featured: Boolean(p.featured),
  thumbnailUrl: p.image,
  logoUrl: p.logo ?? null,
  externalUrl: p.site ?? null,
  serviceCategorySlugs: [],
  technologyTags: [],
  displayOrder: i,
}));

export function usePortfolio() {
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => get<PortfolioSummary[]>("/portfolio"), staleTime: 5 * 60_000, retry: 1 });
  return { ...q, data: q.data ?? (q.isError ? FALLBACK_PORTFOLIO : undefined) };
}

export const usePortfolioProject = (slug: string) =>
  useQuery({ queryKey: ["portfolio", slug], queryFn: () => get<PortfolioDetail>(`/portfolio/${slug}`), retry: 1 });

export const useServices = () => useQuery({ queryKey: ["services"], queryFn: () => get<ServiceCategory[]>("/services"), staleTime: 5 * 60_000 });

export const usePackages = () => useQuery({ queryKey: ["packages"], queryFn: () => get<PackageSummary[]>("/packages"), staleTime: 60_000 });

export const usePackage = (slug: string) => useQuery({ queryKey: ["package", slug], queryFn: () => get<PackageDetail>(`/packages/${slug}`) });

export const useFaqs = (scope: string) => useQuery({ queryKey: ["faqs", scope], queryFn: () => get<Faq[]>(`/faqs?scope=${encodeURIComponent(scope)}`), staleTime: 5 * 60_000 });

export const STATUS_LABELS: Record<PortfolioSummary["statusLabel"], string> = {
  live: "Live",
  in_development: "In development",
  concept: "Concept",
  internal_tool: "Internal tool",
};
