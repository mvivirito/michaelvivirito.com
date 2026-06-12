// Affiliate destinations served from /go/<slug>/.
// Add new entries here; the dynamic route does the rest.
//
// `label` is human-readable, used in the redirect page so a user landing on
// the meta-refresh briefly sees what they're being sent to.
export interface AffiliateLink {
  url: string;
  label: string;
}

export const affiliates: Record<string, AffiliateLink> = {
  'sodola-10g': {
    url: 'https://a.co/d/0bHmg42w',
    label: 'Sodola 12-port 10G managed switch on Amazon',
  },
};
