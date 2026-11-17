import type { PricingRulesInput } from "./rules";

/**
 * DEMONSTRATION rule set.
 *
 * These figures are placeholders that make the configurator testable end-to-end.
 * They are NOT an approved Operandis rate card. The seed loads them as a rule
 * version flagged `isDemo`; the public UI shows a "demo pricing" notice while a
 * demo version is active. The owner must replace them via Admin → Pricing.
 */
const R = (rand: number) => rand * 100;

export const DEMO_PRICING_RULES: PricingRulesInput = {
  currency: "ZAR",
  solutions: [
    { key: "website", label: "Business website", description: "A fast, credible marketing site you can update yourself.", examples: ["Company website", "Landing pages", "Content/blog"], baseMinor: R(25_000), complexityPoints: 1, minWeeks: 3, maxWeeks: 5 },
    { key: "ecommerce", label: "E-commerce store", description: "Sell products or services online with payments and order management.", examples: ["Online shop", "Product configurator", "Subscriptions"], baseMinor: R(55_000), complexityPoints: 3, minWeeks: 5, maxWeeks: 9 },
    { key: "internal_system", label: "Internal business system", description: "Replace spreadsheets and manual admin with one tool for your team.", examples: ["Operations dashboard", "Inventory", "Job management", "Custom CRM"], baseMinor: R(85_000), complexityPoints: 4, minWeeks: 6, maxWeeks: 12 },
    { key: "customer_portal", label: "Customer portal", description: "A secure place where your customers log in, track and transact.", examples: ["Client portal", "Booking system", "Self-service account area"], baseMinor: R(95_000), complexityPoints: 5, minWeeks: 7, maxWeeks: 12 },
    { key: "saas", label: "SaaS product", description: "Software you sell to many customers, with accounts, plans and billing.", examples: ["Multi-tenant platform", "Subscription product"], baseMinor: R(180_000), complexityPoints: 8, minWeeks: 12, maxWeeks: 24 },
    { key: "mobile_app", label: "Mobile app", description: "An app on your customers' or team's phones.", examples: ["Field-service app", "Customer app"], baseMinor: R(120_000), complexityPoints: 6, minWeeks: 10, maxWeeks: 18 },
    { key: "integration", label: "Integration / automation", description: "Connect the tools you already pay for and remove copy-paste work.", examples: ["Store ↔ accounting sync", "Courier automation", "WhatsApp notifications"], baseMinor: R(35_000), complexityPoints: 2, minWeeks: 2, maxWeeks: 5 },
    { key: "unsure", label: "Not sure yet", description: "Describe the problem and we'll recommend the right shape.", examples: [], baseMinor: 0, complexityPoints: 0, minWeeks: 0, maxWeeks: 0, unpriced: true },
  ],
  additionalSolutionBps: 5000,
  featureGroups: [
    { key: "accounts", label: "Accounts & access", description: "Who can log in and what they can do." },
    { key: "commerce", label: "Payments & commerce", description: "Taking money and managing orders." },
    { key: "operations", label: "Operations & workflow", description: "How work moves through your business." },
    { key: "content", label: "Content & communication", description: "What you publish and how you talk to users." },
    { key: "data", label: "Data & reporting", description: "Insight into what's happening." },
  ],
  features: [
    { key: "user_accounts", groupKey: "accounts", label: "User accounts & login", description: "Sign-up, login, password reset.", amountMinor: R(12_000), weeks: 1, complexityPoints: 1 },
    { key: "roles_permissions", groupKey: "accounts", label: "Roles & permissions", description: "Different access for admins, staff and customers.", amountMinor: R(15_000), weeks: 1, complexityPoints: 2, requires: ["user_accounts"] },
    { key: "multi_tenant", groupKey: "accounts", label: "Multiple organisations (multi-tenant)", description: "Separate, isolated workspaces per customer company.", amountMinor: R(45_000), weeks: 3, complexityPoints: 5, requires: ["user_accounts", "roles_permissions"], solutions: ["saas", "customer_portal", "internal_system"] },
    { key: "online_payments", groupKey: "commerce", label: "Online payments", description: "Card/EFT payments through a South African gateway.", amountMinor: R(15_000), weeks: 1, complexityPoints: 2 },
    { key: "subscriptions", groupKey: "commerce", label: "Subscriptions & recurring billing", description: "Plans, renewals and invoices.", amountMinor: R(30_000), weeks: 2, complexityPoints: 3, requires: ["online_payments", "user_accounts"] },
    { key: "product_catalogue", groupKey: "commerce", label: "Product catalogue", description: "Products, variants, stock levels.", amountMinor: R(18_000), weeks: 1, complexityPoints: 2, solutions: ["ecommerce", "internal_system", "saas"] },
    { key: "bookings", groupKey: "operations", label: "Bookings & scheduling", description: "Availability, reservations, reminders.", amountMinor: R(28_000), weeks: 2, complexityPoints: 3 },
    { key: "workflow_approvals", groupKey: "operations", label: "Workflows & approvals", description: "Multi-step processes with sign-off.", amountMinor: R(25_000), weeks: 2, complexityPoints: 3, requires: ["user_accounts"] },
    { key: "inventory", groupKey: "operations", label: "Inventory & stock control", description: "Stock movements across locations.", amountMinor: R(30_000), weeks: 2, complexityPoints: 3 },
    { key: "documents_files", groupKey: "operations", label: "Documents & file uploads", description: "Secure upload, storage and sharing.", amountMinor: R(12_000), weeks: 1, complexityPoints: 1 },
    { key: "offline_mode", groupKey: "operations", label: "Offline mode & sync", description: "Works without signal and syncs later.", amountMinor: R(60_000), weeks: 4, complexityPoints: 6, flags: ["offline_mode"] },
    { key: "cms", groupKey: "content", label: "Content management", description: "Edit pages, posts and media yourself.", amountMinor: R(10_000), weeks: 1, complexityPoints: 1 },
    { key: "notifications", groupKey: "content", label: "Email / SMS / WhatsApp notifications", description: "Automated messages at key moments.", amountMinor: R(12_000), weeks: 1, complexityPoints: 1 },
    { key: "messaging", groupKey: "content", label: "In-app messaging", description: "Conversations between users or with your team.", amountMinor: R(25_000), weeks: 2, complexityPoints: 3, requires: ["user_accounts"] },
    { key: "search", groupKey: "content", label: "Advanced search & filtering", description: "Find anything quickly.", amountMinor: R(10_000), weeks: 1, complexityPoints: 1 },
    { key: "reporting", groupKey: "data", label: "Dashboards & reporting", description: "Charts, KPIs and exports.", amountMinor: R(22_000), weeks: 2, complexityPoints: 2 },
    { key: "audit_trail", groupKey: "data", label: "Audit trail", description: "Who changed what, and when.", amountMinor: R(10_000), weeks: 1, complexityPoints: 1, requires: ["user_accounts"] },
    { key: "sensitive_data", groupKey: "data", label: "Sensitive personal / financial data", description: "ID numbers, health, banking or similar.", amountMinor: R(20_000), weeks: 1, complexityPoints: 3, flags: ["sensitive_data"] },
    { key: "regulated", groupKey: "data", label: "Regulated workflow (FSCA, medical, legal…)", description: "Compliance-driven processes.", amountMinor: R(30_000), weeks: 2, complexityPoints: 4, flags: ["regulated_workflow"] },
  ],
  integrations: [
    { key: "payments", label: "Payment gateway", examples: ["PayFast", "Yoco", "Paystack", "Ozow"], amountMinor: R(12_000), complexityPoints: 2, weeks: 1 },
    { key: "accounting", label: "Accounting", examples: ["Xero", "Sage", "QuickBooks"], amountMinor: R(18_000), complexityPoints: 3, weeks: 1 },
    { key: "crm", label: "CRM", examples: ["HubSpot", "Zoho", "Pipedrive"], amountMinor: R(15_000), complexityPoints: 2, weeks: 1 },
    { key: "messaging", label: "Messaging", examples: ["WhatsApp Business", "SMS", "Email provider"], amountMinor: R(12_000), complexityPoints: 2, weeks: 1 },
    { key: "maps", label: "Maps & location", examples: ["Google Maps", "Mapbox"], amountMinor: R(8_000), complexityPoints: 1, weeks: 0.5 },
    { key: "courier", label: "Courier / logistics", examples: ["The Courier Guy", "Bob Go", "Aramex"], amountMinor: R(18_000), complexityPoints: 3, weeks: 1 },
    { key: "erp_legacy", label: "ERP / legacy system", examples: ["Pastel", "SAP", "In-house database"], amountMinor: R(40_000), complexityPoints: 5, weeks: 3 },
    { key: "other_api", label: "Other API", examples: [], amountMinor: R(15_000), complexityPoints: 2, weeks: 1 },
  ],
  unknownApiSurchargeBps: 3000,
  platforms: [
    { key: "web", label: "Web app (desktop browser)", amountMinor: 0, complexityPoints: 0, weeks: 0 },
    { key: "mobile_web", label: "Mobile-friendly web / PWA", amountMinor: R(8_000), complexityPoints: 1, weeks: 0.5 },
    { key: "ios", label: "Native iOS app", description: "App Store distribution and review.", amountMinor: R(45_000), complexityPoints: 4, weeks: 3, flags: ["native_mobile"] },
    { key: "android", label: "Native Android app", description: "Google Play distribution.", amountMinor: R(40_000), complexityPoints: 4, weeks: 3, flags: ["native_mobile"] },
    { key: "admin_console", label: "Admin back-office", amountMinor: R(15_000), complexityPoints: 2, weeks: 1 },
  ],
  internalUserBands: [
    { key: "none", label: "None", amountMinor: 0, complexityPoints: 0 },
    { key: "1_10", label: "1–10", amountMinor: 0, complexityPoints: 0 },
    { key: "11_50", label: "11–50", amountMinor: R(5_000), complexityPoints: 1 },
    { key: "51_250", label: "51–250", amountMinor: R(12_000), complexityPoints: 2 },
    { key: "250_plus", label: "250+", amountMinor: R(25_000), complexityPoints: 3 },
  ],
  customerUserBands: [
    { key: "none", label: "None", amountMinor: 0, complexityPoints: 0 },
    { key: "under_100", label: "Under 100", amountMinor: 0, complexityPoints: 0 },
    { key: "100_1000", label: "100–1 000", amountMinor: R(5_000), complexityPoints: 1 },
    { key: "1000_10000", label: "1 000–10 000", amountMinor: R(15_000), complexityPoints: 2 },
    { key: "10000_plus", label: "10 000+", amountMinor: R(35_000), complexityPoints: 4 },
  ],
  roleBands: [
    { key: "one", label: "One type of user", amountMinor: 0, complexityPoints: 0 },
    { key: "two_three", label: "2–3 roles", amountMinor: R(5_000), complexityPoints: 1 },
    { key: "four_plus", label: "4 or more roles", amountMinor: R(15_000), complexityPoints: 3 },
  ],
  migrationLevels: [
    { key: "none", label: "Starting fresh", amountMinor: 0, complexityPoints: 0 },
    { key: "light", label: "Some spreadsheets / small dataset", amountMinor: R(8_000), complexityPoints: 1 },
    { key: "moderate", label: "Existing system with moderate data", amountMinor: R(25_000), complexityPoints: 3 },
    { key: "large", label: "Large or legacy dataset", amountMinor: R(60_000), complexityPoints: 6, flags: ["large_migration"] },
  ],
  brandingReadiness: [
    { key: "ready", label: "Brand & designs ready", amountMinor: 0, complexityPoints: 0 },
    { key: "partial", label: "Logo/brand only", amountMinor: R(8_000), complexityPoints: 0 },
    { key: "none", label: "Need design from scratch", amountMinor: R(18_000), complexityPoints: 1 },
  ],
  urgency: [
    { key: "standard", label: "Standard", multiplierBps: 0, description: "Normal scheduling" },
    { key: "priority", label: "Priority", multiplierBps: 1500, description: "Dedicated capacity, compressed calendar" },
    { key: "rush", label: "Rush", multiplierBps: 3000, description: "Earliest possible start, extended hours" },
  ],
  complexityTiers: [
    { upToPoints: 8, multiplierBps: 0, label: "standard" },
    { upToPoints: 18, multiplierBps: 800, label: "moderate" },
    { upToPoints: 30, multiplierBps: 1500, label: "complex" },
    { upToPoints: 1000, multiplierBps: 2500, label: "highly complex" },
  ],
  range: { lowBps: 9000, highBps: { high: 11500, medium: 13000, low: 15000 } },
  roundingStepMinor: R(1_000),
  minimumProjectMinor: R(20_000),
  maxAutoEstimateMinor: R(750_000),
  maxIntegrationsBeforeReview: 4,
  maxPlatformsBeforeReview: 3,
  weeksPerComplexityPoint: 0.2,
  budgetBands: [
    { key: "under_50k", label: "Under R50 000", minMinor: 0, maxMinor: R(50_000) },
    { key: "50k_150k", label: "R50 000 – R150 000", minMinor: R(50_000), maxMinor: R(150_000) },
    { key: "150k_400k", label: "R150 000 – R400 000", minMinor: R(150_000), maxMinor: R(400_000) },
    { key: "400k_1m", label: "R400 000 – R1 million", minMinor: R(400_000), maxMinor: R(1_000_000) },
    { key: "1m_plus", label: "Over R1 million", minMinor: R(1_000_000), maxMinor: null },
    { key: "not_sure", label: "Not sure yet", minMinor: null, maxMinor: null },
  ],
  launchTargets: [
    { key: "asap", label: "As soon as possible (≈1 month)", weeks: 4 },
    { key: "1_3_months", label: "1–3 months", weeks: 12 },
    { key: "3_6_months", label: "3–6 months", weeks: 26 },
    { key: "6_plus_months", label: "6+ months", weeks: 52 },
    { key: "flexible", label: "Flexible", weeks: null },
  ],
  discovery: {
    packageSlug: "discovery-sprint",
    feeMinor: R(7_500),
    recommendAboveMinor: R(150_000),
    description: "A structured discovery engagement that produces a validated scope, architecture outline and fixed-price proposal.",
  },
  deposit: { percentBps: 5000 },
  milestoneSchedule: [
    { key: "deposit", label: "Deposit on acceptance", percentBps: 5000, description: "Secures the start date." },
    { key: "beta", label: "Working beta delivered", percentBps: 3000, description: "Feature-complete build for your review." },
    { key: "launch", label: "Launch & handover", percentBps: 2000, description: "Go-live, documentation and code handover." },
  ],
  packageMappings: [
    { solutionKey: "website", packageSlug: "business-website", maxTotalMinor: R(60_000), maxFeatures: 3 },
    { solutionKey: "ecommerce", packageSlug: "ecommerce-store", maxTotalMinor: R(110_000), maxFeatures: 4 },
  ],
  assumptions: [
    "Content (copy, images, product data) is supplied by you unless stated otherwise.",
    "One round of consolidated feedback per milestone.",
    "Third-party services provide documented, available APIs.",
    "You are available for a weekly check-in during the build.",
  ],
  exclusions: [
    "Ongoing hosting, licences and third-party subscription fees.",
    "Content writing, photography and translations unless scoped.",
    "Changes requested after scope sign-off (handled through change control).",
  ],
  thirdPartyNotes: [
    "Payment gateways, SMS/WhatsApp and app stores charge their own fees.",
    "Hosting is typically billed monthly by the provider directly to you.",
  ],
};
