import type { LegalBundle, LegalConfig } from "./types";

export function englishLegal(config: LegalConfig): LegalBundle {
  return { mainNav: "Main", pricing: "Pricing", signIn: "Sign in", legalNav: "Legal",
    documents: {
      terms: { title: "Terms of Service", effective: "November 27, 2026", updated: "November 27, 2026", summaryTitle: "The short version", summary: "You own your website, app and content. You publish under your own Apple account and follow Apple's rules. We build and maintain the app shell, and you pay for the plan you choose.", sections: [
        { title: "1. Who we are", paragraphs: [`Mobilio is operated by ${config.company}, registered at ${config.address} (“Mobilio”, “we”). These terms are an agreement between us and the person or organization using Mobilio (“you”).`] },
        { title: "2. What Mobilio does", paragraphs: ["Mobilio turns a website you control into an iOS app. We provide previews, test builds for registered devices, and tools to submit your app to the App Store under your Apple Developer account."] },
        { title: "3. Your website and content", paragraphs: ["You may only use websites you own or are authorized to publish. You keep all rights to your content and give us a limited license to load, display and package it only to provide the service."] },
        { title: "4. Apple and the App Store", paragraphs: ["Published apps use your Apple Developer Program membership, and you are the seller of record. Apple decides whether to approve an app. We help with review requirements but cannot guarantee approval. You are responsible for accurate privacy labels, age ratings and store information."] },
        { title: "5. Plans and payments", paragraphs: ["Our Merchant of Record processes payments, taxes and invoices. Subscriptions renew until cancelled. Refunds follow the Refund Policy shown on this site."] },
        { title: "6. Acceptable use", paragraphs: ["Do not use Mobilio to break the law, copy another person’s site or brand, distribute harmful content, or evade Apple’s review. We may suspend use that creates security, legal or operational risk."] },
        { title: "7. Ending the agreement", paragraphs: ["You can cancel at any time. We may suspend accounts that materially breach these terms and will explain why unless the law prevents it. Apps already published under your account remain yours."] },
        { title: "8. Liability", paragraphs: ["To the extent allowed by law, Mobilio is provided as available. We are not responsible for indirect losses or for decisions made by Apple or third-party services. Our total liability for a claim is limited to the amount you paid Mobilio during the twelve months before the claim."] },
        { title: "9. Changes", paragraphs: ["If we make a material change, we will notify workspace owners before it takes effect. Continuing to use Mobilio after that date means you accept the updated terms."] },
        { title: "10. Contact", paragraphs: [`Questions about these terms can be sent to ${config.email}.`] },
      ] },
      privacy: { title: "Privacy Policy", effective: "November 27, 2026", updated: "November 27, 2026", summaryTitle: "The short version", summary: "We use the data needed to run Mobilio, protect accounts and improve the service. We do not sell personal data.", sections: [
        { title: "1. Who controls your data", paragraphs: [`${config.company}, ${config.address}, controls the account and website data described here. Contact ${config.email} with privacy questions.`] },
        { title: "2. Data we collect", paragraphs: ["We collect account details, workspace and project settings, billing references, support messages, security logs and the website content needed to create previews and apps."] },
        { title: "3. How we use data", paragraphs: ["We use data to provide and secure Mobilio, process requests, communicate about the service, prevent abuse and meet legal obligations. We use aggregated data to understand performance and improve the product."] },
        { title: "4. Service providers", paragraphs: ["We share limited data with infrastructure, email, analytics, payment and Apple-related providers when needed to deliver the service. They must protect it and may use it only for the agreed purpose."] },
        { title: "5. Retention and security", paragraphs: ["We keep data while your account is active and as required for security, tax and legal records. We apply access controls, encryption in transit and tenant isolation, but no online service can promise absolute security."] },
        { title: "6. Your choices", paragraphs: [`You may request access, correction or deletion by emailing ${config.email}. Some records may be retained where the law requires it.`] },
      ] },
      refunds: { title: "Refund Policy", effective: "November 27, 2026", updated: "November 27, 2026", summaryTitle: "The short version", summary: "If Mobilio does not work as described, contact us promptly. We review refund requests fairly and follow any mandatory consumer rights that apply.", sections: [
        { title: "1. Subscriptions", paragraphs: ["You can cancel renewal at any time. Access continues through the paid period. Charges already processed are generally non-refundable except where required by law or where the service was materially unavailable."] },
        { title: "2. One-time services", paragraphs: ["Work already delivered for one-time publishing or setup services is non-refundable. If work has not started, contact us and we will review the request."] },
        { title: "3. Apple fees", paragraphs: ["Apple Developer Program fees and any charges paid directly to Apple are controlled by Apple and cannot be refunded by Mobilio."] },
        { title: "4. Requesting a refund", paragraphs: [`Email ${config.email} with your workspace, charge date and reason. We normally respond within five business days.`] },
      ] },
    } };
}
