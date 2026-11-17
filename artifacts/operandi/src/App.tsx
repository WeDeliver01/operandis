import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConsentProvider } from "@/lib/consent";
import { ConsentBanner } from "@/components/ConsentBanner";
import { TagManager } from "@/components/TagManager";
import { AuthProvider, RequireAuth } from "@/lib/auth";
import { LoadingState } from "@/components/ui-kit/states";
import { statusOf } from "@/lib/api";
import NotFound from "@/pages/not-found";

import Home from "@/pages/Home";
import Products from "@/pages/Products";
import Services from "@/pages/Services";
import Process from "@/pages/Process";
import About from "@/pages/About";
import Contact from "@/pages/Contact";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Cookies from "@/pages/Cookies";

import TheBreadProduct from "@/pages/products/TheBread";
import WeshipProduct from "@/pages/products/Weship";
import DenexusProduct from "@/pages/products/Denexus";
import AirhouseProduct from "@/pages/products/Airhouse";
import ElegantCustomiseProduct from "@/pages/products/ElegantCustomise";
import RoutePlannerProduct from "@/pages/products/RoutePlanner";

// Commerce, configurator, portal and console are code-split from the marketing site.
const CaseStudy = lazy(() => import("@/pages/CaseStudy"));
const Packages = lazy(() => import("@/pages/Packages"));
const PackageDetail = lazy(() => import("@/pages/PackageDetail"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const CheckoutReturn = lazy(() => import("@/pages/CheckoutReturn"));
const Configure = lazy(() => import("@/pages/Configure"));
const Estimate = lazy(() => import("@/pages/Estimate"));
const Auth = {
  Login: lazy(() => import("@/pages/auth/AuthPages").then((m) => ({ default: m.Login }))),
  Register: lazy(() => import("@/pages/auth/AuthPages").then((m) => ({ default: m.Register }))),
  Verify: lazy(() => import("@/pages/auth/AuthPages").then((m) => ({ default: m.VerifyEmail }))),
  Magic: lazy(() => import("@/pages/auth/AuthPages").then((m) => ({ default: m.MagicLink }))),
  Forgot: lazy(() => import("@/pages/auth/AuthPages").then((m) => ({ default: m.ForgotPassword }))),
  Reset: lazy(() => import("@/pages/auth/AuthPages").then((m) => ({ default: m.ResetPassword }))),
  Mfa: lazy(() => import("@/pages/auth/AuthPages").then((m) => ({ default: m.MfaChallenge }))),
};
const portal = () => import("@/pages/portal/PortalPages");
const P = {
  Dashboard: lazy(() => portal().then((m) => ({ default: m.PortalDashboard }))),
  Projects: lazy(() => portal().then((m) => ({ default: m.PortalProjects }))),
  Project: lazy(() => portal().then((m) => ({ default: m.PortalProject }))),
  Proposals: lazy(() => portal().then((m) => ({ default: m.PortalProposals }))),
  Proposal: lazy(() => portal().then((m) => ({ default: m.PortalProposal }))),
  Invoices: lazy(() => portal().then((m) => ({ default: m.PortalInvoices }))),
  Invoice: lazy(() => portal().then((m) => ({ default: m.PortalInvoice }))),
  Orders: lazy(() => portal().then((m) => ({ default: m.PortalOrders }))),
  Order: lazy(() => portal().then((m) => ({ default: m.PortalOrder }))),
  Enquiries: lazy(() => portal().then((m) => ({ default: m.PortalEnquiries }))),
  Enquiry: lazy(() => portal().then((m) => ({ default: m.PortalEnquiry }))),
  Requests: lazy(() => portal().then((m) => ({ default: m.PortalRequests }))),
  Notifications: lazy(() => portal().then((m) => ({ default: m.PortalNotifications }))),
  Profile: lazy(() => portal().then((m) => ({ default: m.PortalProfile }))),
};
const crm = () => import("@/pages/admin/AdminCrm");
const ops = () => import("@/pages/admin/AdminOps");
const cat = () => import("@/pages/admin/AdminCatalogue");
const sys = () => import("@/pages/admin/AdminSystem");
const props = () => import("@/pages/admin/AdminProposals");
const A = {
  Dashboard: lazy(() => crm().then((m) => ({ default: m.AdminDashboard }))),
  Leads: lazy(() => crm().then((m) => ({ default: m.AdminLeads }))),
  Lead: lazy(() => crm().then((m) => ({ default: m.AdminLead }))),
  Submissions: lazy(() => crm().then((m) => ({ default: m.AdminSubmissions }))),
  Submission: lazy(() => crm().then((m) => ({ default: m.AdminSubmission }))),
  Reports: lazy(() => crm().then((m) => ({ default: m.AdminReports }))),
  Proposals: lazy(() => props().then((m) => ({ default: m.AdminProposals }))),
  Proposal: lazy(() => props().then((m) => ({ default: m.AdminProposal }))),
  Projects: lazy(() => ops().then((m) => ({ default: m.AdminProjects }))),
  Project: lazy(() => ops().then((m) => ({ default: m.AdminProject }))),
  Requests: lazy(() => ops().then((m) => ({ default: m.AdminRequests }))),
  Orders: lazy(() => ops().then((m) => ({ default: m.AdminOrders }))),
  Order: lazy(() => ops().then((m) => ({ default: m.AdminOrder }))),
  Invoices: lazy(() => ops().then((m) => ({ default: m.AdminInvoices }))),
  Invoice: lazy(() => ops().then((m) => ({ default: m.AdminInvoice }))),
  Payments: lazy(() => ops().then((m) => ({ default: m.AdminPayments }))),
  Packages: lazy(() => cat().then((m) => ({ default: m.AdminPackages }))),
  Package: lazy(() => cat().then((m) => ({ default: m.AdminPackage }))),
  Pricing: lazy(() => cat().then((m) => ({ default: m.AdminPricing }))),
  PricingVersion: lazy(() => cat().then((m) => ({ default: m.AdminPricingVersion }))),
  Portfolio: lazy(() => sys().then((m) => ({ default: m.AdminPortfolio }))),
  PortfolioEdit: lazy(() => sys().then((m) => ({ default: m.AdminPortfolioEdit }))),
  Content: lazy(() => sys().then((m) => ({ default: m.AdminContent }))),
  Users: lazy(() => sys().then((m) => ({ default: m.AdminUsers }))),
  Audit: lazy(() => sys().then((m) => ({ default: m.AdminAudit }))),
  Emails: lazy(() => sys().then((m) => ({ default: m.AdminEmails }))),
  Settings: lazy(() => sys().then((m) => ({ default: m.AdminSettings }))),
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => {
        const s = statusOf(err);
        if (s && s >= 400 && s < 500) return false;
        return count < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);
  return null;
}

const MDX_CASE_STUDIES: Record<string, React.ComponentType> = {
  "the-bread": TheBreadProduct,
  weship: WeshipProduct,
  denexus: DenexusProduct,
  airhouse: AirhouseProduct,
  "elegant-customise": ElegantCustomiseProduct,
  "route-planner": RoutePlannerProduct,
};

/** Bundled MDX case studies keep their long-form pages; any other slug is rendered from the CMS. */
function CaseStudyRoute({ params }: { params: { slug: string } }) {
  const Mdx = MDX_CASE_STUDIES[params.slug];
  return Mdx ? <Mdx /> : <CaseStudy params={params} />;
}

const staff = (C: React.ComponentType<any>, permission?: Parameters<typeof RequireAuth>[0]["permission"]) =>
  // eslint-disable-next-line react/display-name
  (props: any) => (
    <RequireAuth staff permission={permission}>
      <C {...props} />
    </RequireAuth>
  );
const client = (C: React.ComponentType<any>) =>
  // eslint-disable-next-line react/display-name
  (props: any) => (
    <RequireAuth>
      <C {...props} />
    </RequireAuth>
  );

function Router() {
  return (
    <Suspense fallback={<LoadingState full />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/work" component={Products} />
        <Route path="/products" component={Products} />
        <Route path="/work/:slug">{(p) => <Redirect to={`/products/${p.slug}`} replace />}</Route>
        <Route path="/products/:slug" component={CaseStudyRoute} />
        <Route path="/services" component={Services} />
        <Route path="/process" component={Process} />
        <Route path="/about" component={About} />
        <Route path="/contact" component={Contact} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/cookies" component={Cookies} />

        <Route path="/packages" component={Packages} />
        <Route path="/packages/:slug" component={PackageDetail} />
        <Route path="/checkout/return" component={CheckoutReturn} />
        <Route path="/checkout/:slug" component={Checkout} />
        <Route path="/configure" component={Configure} />
        <Route path="/estimate/:reference" component={Estimate} />

        <Route path="/login" component={Auth.Login} />
        <Route path="/register" component={Auth.Register} />
        <Route path="/auth/verify" component={Auth.Verify} />
        <Route path="/auth/magic" component={Auth.Magic} />
        <Route path="/auth/forgot" component={Auth.Forgot} />
        <Route path="/auth/reset" component={Auth.Reset} />
        <Route path="/auth/mfa" component={client(Auth.Mfa)} />

        <Route path="/portal" component={client(P.Dashboard)} />
        <Route path="/portal/projects" component={client(P.Projects)} />
        <Route path="/portal/projects/:id" component={client(P.Project)} />
        <Route path="/portal/proposals" component={client(P.Proposals)} />
        <Route path="/portal/proposals/:id" component={client(P.Proposal)} />
        <Route path="/portal/invoices" component={client(P.Invoices)} />
        <Route path="/portal/invoices/:id" component={client(P.Invoice)} />
        <Route path="/portal/orders" component={client(P.Orders)} />
        <Route path="/portal/orders/:id" component={client(P.Order)} />
        <Route path="/portal/enquiries" component={client(P.Enquiries)} />
        <Route path="/portal/enquiries/:id" component={client(P.Enquiry)} />
        <Route path="/portal/requests" component={client(P.Requests)} />
        <Route path="/portal/notifications" component={client(P.Notifications)} />
        <Route path="/portal/profile" component={client(P.Profile)} />

        <Route path="/admin" component={staff(A.Dashboard, "dashboard.read")} />
        <Route path="/admin/leads" component={staff(A.Leads)} />
        <Route path="/admin/leads/:id" component={staff(A.Lead)} />
        <Route path="/admin/submissions" component={staff(A.Submissions, "submissions.read")} />
        <Route path="/admin/submissions/:id" component={staff(A.Submission, "submissions.read")} />
        <Route path="/admin/proposals" component={staff(A.Proposals, "proposals.manage")} />
        <Route path="/admin/proposals/:id" component={staff(A.Proposal, "proposals.manage")} />
        <Route path="/admin/projects" component={staff(A.Projects)} />
        <Route path="/admin/projects/:id" component={staff(A.Project)} />
        <Route path="/admin/requests" component={staff(A.Requests, "requests.manage")} />
        <Route path="/admin/orders" component={staff(A.Orders, "orders.read")} />
        <Route path="/admin/orders/:id" component={staff(A.Order, "orders.read")} />
        <Route path="/admin/invoices" component={staff(A.Invoices, "invoices.read")} />
        <Route path="/admin/invoices/:id" component={staff(A.Invoice, "invoices.read")} />
        <Route path="/admin/payments" component={staff(A.Payments, "payments.read")} />
        <Route path="/admin/packages" component={staff(A.Packages, "packages.manage")} />
        <Route path="/admin/packages/:id" component={staff(A.Package, "packages.manage")} />
        <Route path="/admin/pricing" component={staff(A.Pricing, "pricing.manage")} />
        <Route path="/admin/pricing/:id" component={staff(A.PricingVersion, "pricing.manage")} />
        <Route path="/admin/portfolio" component={staff(A.Portfolio, "content.manage")} />
        <Route path="/admin/portfolio/:id" component={staff(A.PortfolioEdit, "content.manage")} />
        <Route path="/admin/content" component={staff(A.Content, "content.manage")} />
        <Route path="/admin/reports" component={staff(A.Reports, "dashboard.read")} />
        <Route path="/admin/users" component={staff(A.Users, "users.read")} />
        <Route path="/admin/audit" component={staff(A.Audit, "audit.read")} />
        <Route path="/admin/emails" component={staff(A.Emails, "settings.manage")} />
        <Route path="/admin/settings" component={staff(A.Settings, "settings.manage")} />

        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConsentProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <ScrollToTop />
              <Router />
            </AuthProvider>
          </WouterRouter>
          <TagManager />
          <ConsentBanner />
          <Toaster />
        </ConsentProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
