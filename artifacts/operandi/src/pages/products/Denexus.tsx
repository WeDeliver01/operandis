import { ProductPortraitLayout } from "@/components/ProductPortraitLayout";
import DenexusContent, { meta } from "@/content/products/denexus.mdx";

export default function DenexusProduct() {
  return (
    <ProductPortraitLayout meta={meta}>
      <DenexusContent />
    </ProductPortraitLayout>
  );
}
