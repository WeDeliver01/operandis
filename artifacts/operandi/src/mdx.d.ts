declare module "*.mdx" {
  import type { ComponentType } from "react";
  // Each case-study MDX exports its metadata alongside the default body component.
  export const meta: {
    name: string;
    oneLiner: string;
    hero: string;
    sector: string;
    type: string;
    stack: string;
    status: string;
    site?: string;
    logo?: string;
    access?: string;
  };
  const MDXComponent: ComponentType<Record<string, unknown>>;
  export default MDXComponent;
}
