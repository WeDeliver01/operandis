export interface ProductSummary {
  slug: string;
  name: string;
  oneLiner: string;
  image: string;
  logo?: string;
  site?: string;
  featured?: boolean;
}

export const products: ProductSummary[] = [
  {
    slug: "delectables",
    name: "Delectables",
    oneLiner:
      "Gauteng's bakery marketplace: order celebration cakes, breads and pastries from independent bakers, with a live-priced cake designer, group orders and next-day delivery.",
    image: "/screens/delectables-hero.png",
    logo: "/logos/delectables.png",
    site: "https://delectabless.co.za",
    featured: true,
  },
  {
    slug: "weship",
    name: "WeShip",
    oneLiner:
      "Multi-tenant SaaS logistics platform for South African eCommerce: courier aggregation, billing, and shipment tracking.",
    image: "/screens/weship-hero.png",
    logo: "/logos/weship.png",
    site: "https://app.weship.co.za",
    featured: true,
  },
  {
    slug: "denexus",
    name: "DeNexus",
    oneLiner:
      "A unified command centre for a courier and a delicatessen: CRM, WhatsApp inbox, shipments, and team chat in one app.",
    image: "/screens/denexus-hero.jpg",
    logo: "/logos/denexus.png",
  },
  {
    slug: "airhouse",
    name: "Airhouse",
    oneLiner:
      "A two-sided marketplace connecting property developers with content creators for performance-driven marketing.",
    image: "/screens/airhouse-hero.png",
    logo: "/logos/airhouse.png",
    site: "https://airhouse.co.za",
    featured: true,
  },
  {
    slug: "elegant-customise",
    name: "Elegant Customise",
    oneLiner:
      "A personalised drinkware storefront with a live mockup canvas, checkout, and admin analytics.",
    image: "/screens/elegant-hero.png",
    site: "https://elegantcustomise.co.za",
  },
  {
    slug: "route-planner",
    name: "Route Planner",
    oneLiner: "A courier route-optimisation tool for daily delivery planning.",
    image: "/screens/route-planner-hero.jpg",
    logo: "/logos/delicate-routes.png",
  },
];

export const flagshipProducts = products.filter((p) => p.featured);
export const supportingProducts = products.filter((p) => !p.featured);

