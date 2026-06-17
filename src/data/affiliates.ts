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
  'samsung-odyssey-g9': {
    url: 'https://amzn.to/4xD1Bjq',
    label: 'Samsung 49" Odyssey G9 (G93SC) QD-OLED monitor on Amazon',
  },
  'lamicall-laptop-stand': {
    url: 'https://amzn.to/4ouMUL0',
    label: 'Lamicall adjustable laptop stand on Amazon',
  },
  'anker-dock': {
    url: 'https://amzn.to/4emSKJO',
    label: 'Anker DL6350 10-port docking station on Amazon',
  },
  'logitech-g502x': {
    url: 'https://amzn.to/4a7xLJD',
    label: 'Logitech G502 X Lightspeed wireless mouse on Amazon',
  },
  'obsbot-tiny2-lite': {
    url: 'https://amzn.to/4xzJryP',
    label: 'OBSBOT Tiny 2 Lite 4K webcam on Amazon',
  },
  'razer-seiren-v3': {
    url: 'https://amzn.to/4veXmZA',
    label: 'Razer Seiren V3 Chroma USB microphone on Amazon',
  },
  'ugreen-usb-switch': {
    url: 'https://amzn.to/4uEfniO',
    label: 'UGREEN USB switch selector on Amazon',
  },
  'kef-lsx-ii-lt': {
    url: 'https://amzn.to/43EbIa0',
    label: 'KEF LSX II LT wireless HiFi speakers on Amazon',
  },
  'putorsen-speaker-stands': {
    url: 'https://amzn.to/43FXlSp',
    label: 'PUTORSEN desktop speaker stands on Amazon',
  },
  'vivo-standing-desk-legs': {
    url: 'https://amzn.to/4oQZxjX',
    label: 'VIVO electric dual-motor standing desk frame on Amazon',
  },
  'advantage360': {
    url: 'https://amzn.to/43C0Nxx',
    label: 'Kinesis Advantage360 Professional split keyboard on Amazon',
  },
  'akg-k240-studio': {
    url: 'https://amzn.to/4uIrqvL',
    label: 'AKG K240 Studio semi-open headphones on Amazon',
  },
};
