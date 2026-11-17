import { LegalLayout } from "@/components/LegalLayout";

export default function Cookies() {
  return (
    <LegalLayout title="Cookie Notice" breadcrumb="COOKIES" lastUpdated="16 May 2026">
      <p>
        This notice explains the cookies and similar technologies used on the Operandis website,
        why we use them, and the choices you have. We use cookies both to keep the site running
        and to understand how people find and use it so we can improve our marketing.
      </p>

      <h2>Strictly necessary</h2>
      <p>
        These cookies are required for the site to work and are set automatically. They include
        cookies set by our hosting platform (for example a load-balancer cookie or a session
        token) and the cookies needed to load the embedded Cal.com booking widget when you
        choose to book a call. We do not ask for consent for these because the site cannot
        function without them.
      </p>

      <h2>Analytics</h2>
      <p>
        With your consent, we use <strong>Google Analytics 4</strong> to understand which pages
        visitors look at, which products generate interest, and which marketing channels lead
        people to us. Google Analytics sets cookies in the <code>_ga</code> family and processes
        your IP address (truncated where supported) and a randomly generated client ID. We do
        not use Google Signals or advertising features inside Analytics.
      </p>

      <h2>Advertising and remarketing</h2>
      <p>
        With your consent, we run advertising and remarketing campaigns on third-party platforms
        and load their measurement pixels on this site so we can attribute leads, optimise
        spend, and show relevant follow-up ads. The pixels and tags we use include:
      </p>
      <ul>
        <li><strong>Google Ads</strong> conversion tags and remarketing cookies.</li>
        <li><strong>Meta Pixel</strong> (Facebook and Instagram) for conversion tracking and audience building.</li>
        <li><strong>LinkedIn Insight Tag</strong> for B2B campaign measurement and matched audiences.</li>
      </ul>
      <p>
        These set first- and third-party cookies and share a hashed identifier and basic event
        data with the relevant platform. We may, from time to time, add other marketing or
        attribution tags; when we do we will update this notice.
      </p>

      <h2>Your consent and how to change it</h2>
      <p>
        On your first visit you'll see a consent banner. You can accept all categories, reject
        all non-essential cookies, or choose per category. We only load analytics and advertising
        scripts after you accept the relevant category, in line with POPIA's consent requirement
        for non-essential processing. You can change or withdraw your choice at any time by
        clearing this site's cookies in your browser, which will re-trigger the banner on your
        next visit.
      </p>

      <h2>Browser controls and opt-outs</h2>
      <p>
        You can clear or block cookies in your browser's privacy settings. You can also opt out
        of Google Analytics across all sites by installing the{" "}
        <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
          Google Analytics opt-out browser add-on
        </a>
        , and manage ad personalisation through Google's{" "}
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
          Ad Settings
        </a>{" "}
        and Meta's{" "}
        <a href="https://www.facebook.com/adpreferences" target="_blank" rel="noopener noreferrer">
          Ad Preferences
        </a>
        .
      </p>

      <h2>Cross-border transfers</h2>
      <p>
        The advertising and analytics platforms above are operated by companies based outside
        South Africa. When you consent, your data may be transferred to and processed in those
        jurisdictions. We rely on the conditions for lawful transfer set out in section 72 of
        POPIA, including the contractual safeguards each platform provides.
      </p>

      <h2>Questions</h2>
      <p>
        Email <a href="mailto:legal@operandi.studio">legal@operandi.studio</a> if you'd like more
        detail or want to exercise your POPIA rights in relation to cookie data.
      </p>
    </LegalLayout>
  );
}
