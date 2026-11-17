import { useEffect } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";
import { ProductTile } from "@/components/ProductTile";
import { SupportingBuilds } from "@/components/SupportingBuilds";
import { flagshipProducts, supportingProducts } from "@/content/products";

export default function Products() {
  useEffect(() => {
    document.title = "Products we've built — Operandi";
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      <main className="flex-grow">
        <section className="pt-32 pb-12 md:pb-16">
          <Container>
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
              OPERANDI / PRODUCTS
            </div>
            <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight">
              Some of what we've built.
            </h1>
            <p className="font-sans text-[18px] text-muted max-w-[640px] mt-4 leading-relaxed">
              A preview of our flagship builds: production systems we designed, shipped, and run ourselves. Click any one to read how it's built. There's more we can't show publicly; ask us about it on a call.
            </p>
          </Container>
        </section>

        <section className="pb-16 md:pb-20">
          <Container>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {flagshipProducts.map((product) => (
                <ProductTile key={product.slug} {...product} />
              ))}
            </div>
          </Container>
        </section>

        {supportingProducts.length > 0 && (
          <section className="pb-20 md:pb-24">
            <Container>
              <div className="max-w-[860px]">
                <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
                  ALSO IN THE WORKSHOP
                </div>
                <h2 className="font-serif text-[28px] md:text-[36px] font-medium text-ink leading-tight">
                  Supporting builds.
                </h2>
                <p className="font-sans text-[16px] text-muted mt-3 leading-relaxed">
                  Shorter writeups on other systems we've shipped: internal tools and niche products that don't need the full portrait treatment, but show the range of what we take on.
                </p>
              </div>

              <div className="mt-12">
                <SupportingBuilds />
              </div>
            </Container>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
