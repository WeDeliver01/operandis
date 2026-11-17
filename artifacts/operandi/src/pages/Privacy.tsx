import { LegalLayout } from "@/components/LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" breadcrumb="PRIVACY" lastUpdated="16 May 2026">
      <p>
        Operandi ("we", "us", "our") respects your privacy. This policy explains what personal
        information we collect when you interact with this website or engage us as a client, how
        we use it, and the rights you have under the South African Protection of Personal
        Information Act, 2013 ("POPIA").
      </p>

      <h2>1. Who we are</h2>
      <p>
        Operandi is the trading name of an independent custom software studio based in Pretoria,
        South Africa. For the purposes of POPIA we are the Responsible Party for the personal
        information processed through this website and in the course of our client work.
      </p>
      <p>
        <strong>Contact for privacy matters:</strong>{" "}
        <a href="mailto:legal@operandi.studio">legal@operandi.studio</a>
        <br />
        <strong>Postal address:</strong> 10 Camellia Avenue, Lynnwood, Pretoria, 0081, South Africa
      </p>

      <h2>2. Information we collect</h2>
      <p>We only collect personal information that you give us directly. Specifically:</p>
      <ul>
        <li>
          <strong>When you email us:</strong> your name, email address, and anything you choose to
          tell us about your business or project.
        </li>
        <li>
          <strong>When you book a working session:</strong> your name, email address, company name,
          and the time slot you select.
        </li>
        <li>
          <strong>When you become a client:</strong> the information necessary to deliver the
          engagement: contracts, invoices, project documentation, and any data you give us
          access to so that we can build software for you.
        </li>
      </ul>
      <p>
        <strong>Website analytics and marketing:</strong> with your consent, we use Google
        Analytics 4 to understand how visitors use this site, and load advertising and
        measurement pixels from Google Ads, Meta (Facebook and Instagram), and LinkedIn so we
        can run, measure, and optimise our marketing campaigns. These tools collect technical
        identifiers (cookie IDs, IP address, device and browser information) and the pages and
        events you trigger on this site. You can accept, refuse, or change your choice from the
        consent banner at any time. Full detail is in our{" "}
        <a href="/cookies">Cookie Notice</a>.
      </p>

      <h2>3. How we use your information</h2>
      <p>We use personal information only for the purposes for which you gave it to us:</p>
      <ul>
        <li>to respond to your enquiry;</li>
        <li>to schedule and run a working session;</li>
        <li>to scope, deliver, support, and invoice for client engagements;</li>
        <li>to comply with our legal and tax obligations.</li>
      </ul>
      <p>
        We do not sell personal information. We do not share it with third parties for their own
        marketing.
      </p>

      <h2>4. Lawful basis for processing</h2>
      <p>
        We process personal information either with your consent (when you email or book us), to
        perform a contract you've entered into with us, or to comply with a legal obligation.
      </p>

      <h2>5. Sharing with operators</h2>
      <p>
        To run the studio we use a small number of third-party services that act as Operators on
        our behalf, for example our email provider, calendar/booking provider, accounting
        software, payment provider, and the cloud infrastructure on which client systems are
        hosted. Each of these is bound by contract and applicable data-protection law to process
        information only on our instructions.
      </p>

      <h2>6. Cross-border transfers</h2>
      <p>
        Some of the operators above are based outside South Africa. Where personal information is
        transferred across borders, we rely on the conditions for lawful transfer set out in
        section 72 of POPIA, including contractual safeguards with the recipient.
      </p>

      <h2>7. How long we keep it</h2>
      <p>
        We retain personal information for as long as is necessary for the purpose it was collected
        and to meet our legal, accounting, and tax obligations. Enquiry correspondence is typically
        kept for up to two years; client records (contracts, invoices, project artefacts) are kept
        for at least five years after the engagement ends, in line with South African accounting
        and tax law.
      </p>

      <h2>8. Security</h2>
      <p>
        We take reasonable technical and organisational measures to protect personal information
        in our care, including access controls, encryption in transit, encrypted backups,
        and the principle of least privilege. No system is perfectly secure; if a breach affects
        your personal information we will notify you and the Information Regulator as required by
        POPIA.
      </p>

      <h2>9. Your rights</h2>
      <p>Under POPIA you have the right to:</p>
      <ul>
        <li>ask what personal information we hold about you;</li>
        <li>ask us to correct or delete it;</li>
        <li>object to processing on reasonable grounds;</li>
        <li>withdraw consent where processing relies on consent;</li>
        <li>lodge a complaint with the Information Regulator of South Africa.</li>
      </ul>
      <p>
        To exercise any of these rights, email{" "}
        <a href="mailto:legal@operandi.studio">legal@operandi.studio</a>. We will respond within a
        reasonable period and at no cost.
      </p>

      <h2>10. Information Regulator</h2>
      <p>
        Information Regulator (South Africa)
        <br />
        JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001
        <br />
        Email:{" "}
        <a href="mailto:inforeg@justice.gov.za">inforeg@justice.gov.za</a>
        <br />
        Website:{" "}
        <a href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">
          inforegulator.org.za
        </a>
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. The "last updated" date above will always
        reflect the current version. Material changes will be highlighted at the top of the page
        for at least 30 days.
      </p>
    </LegalLayout>
  );
}
