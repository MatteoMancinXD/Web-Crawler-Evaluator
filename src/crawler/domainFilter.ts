// ============================================================
// src/crawler/domainFilter.ts
// Blacklist, government/PA exclusion, platform filters, and domain normalisation
// ============================================================

import { URL } from 'url';

// ─── Blacklisted Mega-Platforms, Socials, Developers & Ad Networks ───

const EXACT_BLACKLIST = new Set([
  // ─── Social & messaging ─────────────────────────────────────
  'facebook.com', 'instagram.com', 'linkedin.com', 'licdn.com', 'x.com',
  'twitter.com', 'threads.net', 'tiktok.com', 'pinterest.com', 'pinterest.it',
  'snapchat.com', 'telegram.org', 't.me', 'whatsapp.com', 'wa.me', 'reddit.com',
  'redd.it', 'tumblr.com', 'vimeo.com', 'dailymotion.com', 'discord.com',
  'discord.gg', 'twitch.tv', 'quora.com', 'soundcloud.com', 'spotify.com',

  // ─── Big Tech, Search & OS ──────────────────────────────────
  'google.com', 'google.it', 'apple.com', 'icloud.com', 'microsoft.com',
  'windows.com', 'live.com', 'outlook.com', 'office.com', 'amazon.com',
  'amazon.it', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'yandex.com',
  'baidu.com',

  // ─── Wikipedia / Wikimedia Foundation ───────────────────────
  'wikipedia.org', 'wikimedia.org', 'wikisource.org', 'wiktionary.org',
  'wikibooks.org', 'wikiquote.org', 'wikivoyage.org', 'wikidata.org',
  'wikinews.org', 'wikiversity.org', 'mediawiki.org', 'wmflabs.org',

  // ─── Developer & Q&A networks ──────────────────────────────
  'stackoverflow.com', 'stackexchange.com', 'serverfault.com', 'superuser.com',
  'askubuntu.com', 'stackauth.com', 'sstatic.net', 'github.com', 'github.io',
  'gitlab.com', 'bitbucket.org', 'npmjs.com', 'npmjs.org', 'pypi.org',
  'codepen.io', 'jsfiddle.net', 'dev.to',

  // ─── YouTube ecosystem ─────────────────────────────────────
  'youtube.com', 'youtubekids.com', 'youtube-nocookie.com', 'youtu.be', 'ytimg.com',

  // ─── Compliance / Cookie banners ───────────────────────────
  'iubenda.com', 'cookiebot.com', 'cookieyes.com', 'onetrust.com', 'trustarc.com',
  'usercentrics.eu', 'complianz.io', 'quantcast.com', 'didomi.io',

  // ─── CDNs & Developer infra ────────────────────────────────
  'cloudflare.com', 'cloudflareinsights.com', 'akamaized.net', 'akamaihd.net',
  'fastly.net', 'fastly.com', 'jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com',
  'bootstrapcdn.com', 'cloudfront.net', 'gravatar.com', 'wp.com',

  // ─── Site builders / Hosted platforms ───────────────────────
  'wordpress.org', 'wordpress.com', 'wix.com', 'squarespace.com', 'weebly.com',
  'jimdo.com', 'blogger.com', 'blogspot.com', 'medium.com', 'substack.com',
  'shopify.com', 'stripe.com', 'paypal.com', 'patreon.com',

  // ─── Analytics, ad networks, ad servers & trackers ─────────
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
  'googlesyndication.com', 'googleadservices.com', '2mdn.net', 'criteo.com',
  'criteo.net', 'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'outbrain.com',
  'taboola.com', 'smartadserver.com', 'amazon-adsystem.com', 'adroll.com',
  'openx.net', 'casalemedia.com', 'chartbeat.com', 'scorecardresearch.com',
  'quantserve.com', 'hotjar.com', 'clarity.ms', 'intercom.io', 'zendesk.com',
  'hubspot.com', 'mailchimp.com', 'mailerlite.com',

  // ─── EMAIL / MAILING SERVICES ──────────────────────────────
  'brevo.com', 'sendinblue.com', 'sendgrid.com', 'mailgun.com', 'constantcontact.com',
  'campaignmonitor.com', 'getresponse.com', 'convertkit.com', 'aweber.com',
  'activecampaign.com', 'drip.com', 'moosend.com', 'benchmark.email',
  'mailjet.com', 'sparkpost.com', 'postmark.com', 'mailtrap.io',
  'protonmail.com', 'proton.me', 'tutanota.com',
  'pec.it', 'legalmail.it', 'aruba.it', 'arubapec.it',

  // ─── MAJOR NEWS / JOURNALS / MEDIA (IT + international) ────
  // These are professionally maintained; never leads for web redesign
  'corriere.it', 'repubblica.it', 'lastampa.it', 'ilsole24ore.com',
  'ansa.it', 'agi.it', 'adnkronos.com', 'ilmessaggero.it', 'ilgiornale.it',
  'ilfattoquotidiano.it', 'fanpage.it', 'tgcom24.mediaset.it', 'tg24.sky.it',
  'rainews.it', 'open.online', 'huffingtonpost.it', 'today.it',
  'gazzetta.it', 'sport.sky.it', 'tuttosport.com', 'corrieredellosport.it',
  'virgilio.it', 'libero.it', 'tiscali.it', 'msn.com',
  'ilpost.it', 'wired.it', 'linkiesta.it', 'internazionale.it',
  'bbc.com', 'bbc.co.uk', 'cnn.com', 'nytimes.com', 'theguardian.com',
  'washingtonpost.com', 'reuters.com', 'apnews.com', 'aljazeera.com',
  'lemonde.fr', 'spiegel.de', 'elpais.com', 'forbes.com', 'bloomberg.com',
  'techcrunch.com', 'theverge.com', 'arstechnica.com', 'wired.com',
  'mediaset.it', 'sky.it', 'rai.it',

  // ─── HOSTING / DOMAIN REGISTRARS ───────────────────────────
  'godaddy.com', 'namecheap.com', 'ovh.com', 'ovh.it', 'register.it',
  'siteground.com', 'bluehost.com', 'hostgator.com', 'dreamhost.com',
  'ionos.com', 'ionos.it', 'hetzner.com', 'digitalocean.com', 'linode.com',
  'vultr.com', 'aws.amazon.com', 'azure.microsoft.com', 'cloud.google.com',
  'netlify.com', 'vercel.com', 'heroku.com', 'render.com', 'fly.io',
  'altervista.org', 'netsons.com', 'tophost.it', 'serverplan.com',
  'keliweb.it', 'vhosting.it', 'flamenetworks.com',

  // ─── E-COMMERCE MARKETPLACES ───────────────────────────────
  'ebay.it', 'ebay.com', 'aliexpress.com', 'alibaba.com', 'wish.com',
  'etsy.com', 'zalando.it', 'zalando.com', 'asos.com',
  'subito.it', 'kijiji.it', 'bakeca.it', 'secondamano.it',
  'eprice.it', 'unieuro.it', 'mediaworld.it', 'euronics.it',

  // ─── BANKS / FINANCIAL INSTITUTIONS ────────────────────────
  'intesasanpaolo.com', 'unicredit.it', 'bnl.it', 'bancamediolanum.it',
  'fineco.it', 'finecobank.com', 'ing.it', 'ing.com', 'widiba.it',
  'credem.it', 'bancobpm.it', 'poste.it', 'postepay.it',
  'nexi.it', 'visa.com', 'mastercard.com',
  'revolut.com', 'n26.com', 'wise.com', 'satispay.com',

  // ─── TELECOM / ISP ─────────────────────────────────────────
  'tim.it', 'vodafone.it', 'windtre.it', 'fastweb.it', 'iliad.it',
  'posteitaliane.it', 'sky.it', 'dazn.com',
  'at-t.com', 'verizon.com', 'bt.com', 'orange.com', 'telefonica.com',

  // ─── TRAVEL / BOOKING / TRANSPORT ──────────────────────────
  'booking.com', 'tripadvisor.com', 'tripadvisor.it', 'expedia.com',
  'airbnb.com', 'airbnb.it', 'hotels.com', 'kayak.com', 'skyscanner.com',
  'skyscanner.it', 'edreams.it', 'volagratis.com', 'lastminute.com',
  'ryanair.com', 'easyjet.com', 'alitalia.com', 'italotreno.it',
  'trenitalia.com', 'trainline.com', 'flixbus.it', 'blablacar.it',

  // ─── FOOD DELIVERY / RESTAURANT AGGREGATORS ────────────────
  'justeat.it', 'deliveroo.it', 'ubereats.com', 'glovo.com',
  'thefork.it', 'thefork.com',

  // ─── JOB BOARDS / RECRUITMENT ──────────────────────────────
  'indeed.com', 'glassdoor.com', 'monster.com', 'infojobs.it',
  'randstad.it', 'adecco.it', 'manpower.it', 'almalaurea.it',
  'helplavoro.it', 'jobbydoo.it', 'careerjet.it',

  // ─── CLASSIFIEDS / COMPARISON / REVIEW AGGREGATORS ─────────
  'trustpilot.com', 'yelp.com', 'paginegialle.it', 'paginebianche.it',
  'trovaprezzi.it', 'idealo.it', 'kelkoo.it', 'segugio.it',
  'facile.it', 'comparasemplice.it', 'sostariffe.it',
  'immobiliare.it', 'idealista.it', 'casa.it', 'tecnocasa.it',
  'autoscout24.it', 'automobile.it',

  // ─── SaaS / BUSINESS TOOLS ─────────────────────────────────
  'trello.com', 'slack.com', 'notion.so', 'asana.com', 'monday.com',
  'jira.com', 'atlassian.com', 'confluence.atlassian.com',
  'salesforce.com', 'zoho.com', 'freshdesk.com', 'freshworks.com',
  'airtable.com', 'canva.com', 'figma.com', 'miro.com', 'loom.com',
  'dropbox.com', 'box.com', 'wetransfer.com',

  // ─── MISC ENTERPRISE / HIGH-PROFILE ────────────────────────
  'crunchbase.com', 'producthunt.com', 'angellist.com', 'capterra.com',
  'g2.com', 'sourceforge.net', 'cnet.com', 'zdnet.com',
  'imdb.com', 'rottentomatoes.com', 'letterboxd.com',
  'goodreads.com', 'scribd.com', 'slideshare.net', 'issuu.com',
  'archive.org', 'w3.org', 'w3schools.com', 'mdn.io',
  'coni.it', 'olimpiadi.it',

  // ─── FONT / ICON / ASSET SERVICES ──────────────────────────
  'fonts.google.com', 'fonts.googleapis.com', 'fontawesome.com',
  'use.fontawesome.com', 'typekit.net', 'use.typekit.net',
  'fonts.bunny.net',
]);

// Suffix / Substring blacklist for infra / CDN / ad providers
const SUFFIX_BLACKLIST = [
  '.google.', '.googleapis.', '.gstatic.',
  '.googlesyndication.', '.googleadservices.', '.2mdn.',
  '.wixsite.com', '.wordpress.com', '.blogspot.com',
  '.myshopify.com', '.github.io', '.zendesk.com',
];

// Regex patterns for large platform families, search engines, encyclopedias, developer Q&A
const PLATFORM_PATTERNS = [
  // Wikimedia ecosystem (any subdomains like it.wikisource.org, la.wikipedia.org, commons.wikimedia.org)
  /(?:^|\.)wiki(?:pedia|media|data|source|tionary|books|quote|voyage|news|versity|functions)\.org$/i,
  /(?:^|\.)mediawiki\.org$/i,
  /(?:^|\.)wmflabs\.org$/i,

  // YouTube ecosystem (YouTube, YouTube Kids, NoCookie, shorteners)
  /(?:^|\.)(?:youtube|youtubekids|youtube-nocookie)\.[a-z]{2,}$/i,
  /(?:^|\.)youtu\.be$/i,
  /(?:^|\.)ytimg\.com$/i,

  // Stack Exchange Network (Stack Overflow, Server Fault, Super User, Ask Ubuntu)
  /(?:^|\.)(?:stackoverflow|stackexchange|serverfault|superuser|askubuntu|stackauth|sstatic)\.(?:com|net|org)$/i,

  // Search engines & Big Tech across any country-code TLD (.it, .com, .co.uk, .de, .fr, etc.)
  /(?:^|\.)google\.[a-z]{2,}(?:\.[a-z]{2,})?$/i,
  /(?:^|\.)amazon\.[a-z]{2,}(?:\.[a-z]{2,})?$/i,
  /(?:^|\.)ebay\.[a-z]{2,}(?:\.[a-z]{2,})?$/i,
  /(?:^|\.)yahoo\.[a-z]{2,}(?:\.[a-z]{2,})?$/i,
  /(?:^|\.)bing\.[a-z]{2,}(?:\.[a-z]{2,})?$/i,
  /(?:^|\.)pinterest\.[a-z]{2,}(?:\.[a-z]{2,})?$/i,

  // URL shorteners (often point to social / arbitrary redirects)
  /(?:^|\.)(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly)$/i,
];

// ─── Government, Region, Public Administration & Institutional Exclusions ────

const GOV_EXACT = new Set([
  // Italian National Organs & Ministries
  'governo.it', 'senato.it', 'camera.it', 'quirinale.it', 'giustizia.it',
  'istruzione.it', 'esteri.it', 'difesa.it', 'interno.it', 'mef.it',
  'mit.it', 'salute.it', 'sviluppoeconomico.gov.it', 'mimit.gov.it',
  // Law Enforcement & Emergency
  'poliziadistato.it', 'carabinieri.it', 'guardiadifinanza.it', 'vigilfuoco.it',
  'vigilidelfuoco.it', 'protezionecivile.it', 'crocerossa.it', 'cri.it',
  // Public Agencies & Welfare
  'inps.it', 'inail.it', 'istat.it', 'infocamere.it', 'registroimprese.it',
  'garanteprivacy.it', 'anticorruzione.it', 'servizirl.it', 'agenziaentrate.it',
  'agenziadelleentrate.it', 'agenziademanio.it', 'agenziadoganemonopoli.gov.it',
  // EU & International Governmental Bodies
  'europa.eu', 'un.org', 'who.int', 'nato.int', 'unesco.org', 'oecd.org',
  'imf.org', 'worldbank.org', 'wto.org', 'redcross.org', 'icrc.org',
]);

const GOV_PATTERNS = [
  // Worldwide Government, Education, Military, Institutional TLDs
  /(?:^|\.)gov(?:\.[a-z]{2,})?$/i,         // gov.uk, .gov, .gov.it, .gouv.fr, etc.
  /(?:^|\.)edu(?:\.[a-z]{2,})?$/i,         // .edu, edu.it, .edu.au, etc.
  /(?:^|\.)mil(?:\.[a-z]{2,})?$/i,         // .mil, mil.it, etc.
  /(?:^|\.)ac\.[a-z]{2,}$/i,               // .ac.it, .ac.uk (academic)
  /(?:^|\.)nic\.[a-z]{2,}$/i,              // .nic.it, .nic.uk (registry operators)
  /\.int$/i,                               // .int (international treaty organizations)

  // Local Government: Regioni, Comuni, Province, Città Metropolitane
  /(?:^|\.)regione\.[a-z0-9-]+\.[a-z]{2,}$/i,             // regione.lombardia.it, etc.
  /(?:^|\.)regione-[a-z0-9-]+\.[a-z]{2,}$/i,             // regione-lombardia.it
  /(?:^|\.)comune\.[a-z0-9-]+\.[a-z0-9-]+\.[a-z]{2,}$/i,  // comune.roma.rm.it, etc.
  /(?:^|\.)comune\.[a-z0-9-]+\.[a-z]{2,}$/i,             // comune.roma.it, comune.milano.it
  /(?:^|\.)comune-[a-z0-9-]+\.[a-z]{2,}$/i,              // comune-roma.it
  /(?:^|\.)provincia\.[a-z0-9-]+\.[a-z]{2,}$/i,          // provincia.torino.it
  /(?:^|\.)cittametropolitana\.[a-z0-9-]+\.[a-z]{2,}$/i,  // cittametropolitana.torino.it
  /(?:^|\.)prefettura\.[a-z0-9-]+\.[a-z]{2,}$/i,         // prefettura.it
  /(?:^|\.)questura\.[a-z0-9-]+\.[a-z]{2,}$/i,           // questura.it

  // Public Health & Environmental Agencies (ASL, AUSL, ATS, ASST, ARPA)
  /(?:^|\.)(?:asl|ausl|ats|asst)[a-z0-9-]*\.[a-z]{2,}$/i, // aslroma1.it, ausl.bologna.it
  /(?:^|\.)arpa[a-z0-9-]*\.[a-z]{2,}$/i,                 // arpalombardia.it, arpae.it
];

/**
 * Returns true if the hostname belongs to a governmental body, public administration,
 * region, municipality, or public health institution.
 */
export function isGovernmentOrPublicEntity(cleanHostname: string): boolean {
  for (const gov of GOV_EXACT) {
    if (cleanHostname === gov || cleanHostname.endsWith('.' + gov)) {
      return true;
    }
  }

  for (const pattern of GOV_PATTERNS) {
    if (pattern.test(cleanHostname)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract the registrable domain (eTLD+1) from a hostname.
 */
export function getRegistrableDomain(hostname: string): string {
  return hostname.replace(/^www\./, '');
}

/**
 * Return true if the given hostname is a valid, auditable domain.
 * Allows any valid TLD (.it, .com, .net, .org, .eu, .io, etc.),
 * excluding government, public administration, regions, and blacklisted mega-platforms.
 */
export function isAllowedDomain(hostname: string, isSeed = false): boolean {
  const clean = hostname.toLowerCase().replace(/^www\./, '');

  if (clean.length < 3 || clean.includes('localhost')) return false;

  // Reject IP addresses (e.g. 192.168.1.1)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) return false;

  // Must have at least a domain name and a TLD
  const labels = clean.split('.');
  if (labels.length < 2) return false;

  // Must have a valid TLD (2 to 24 alphabetic characters)
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,24}$/i.test(tld)) return false;

  if (isSeed) {
    return true;
  }

  // Exact or subdomain blacklist check (social networks, search engines, mega platforms)
  for (const blacklisted of EXACT_BLACKLIST) {
    if (clean === blacklisted || clean.endsWith('.' + blacklisted)) {
      return false;
    }
  }

  // Suffix pattern blacklist (CDNs, Google, Apple, etc.)
  if (SUFFIX_BLACKLIST.some((suffix) => clean.endsWith(suffix) || clean.includes(suffix))) {
    return false;
  }

  // Platform families pattern check (Wikisource, YouTubeKids, StackOverflow, etc.)
  for (const pattern of PLATFORM_PATTERNS) {
    if (pattern.test(clean)) {
      return false;
    }
  }

  // Government, public administration, regions, municipalities, education, military
  if (isGovernmentOrPublicEntity(clean)) {
    return false;
  }

  return true;
}

/**
 * Normalise a URL to the domain root: https://example.com/
 * Returns null if the URL is invalid or blocked.
 */
export function normaliseToDomainRoot(href: string, base?: string): string | null {
  try {
    const url = new URL(href, base);
    const hostname = url.hostname.toLowerCase();

    // Only http/https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    if (!isAllowedDomain(hostname)) return null;

    return `https://${hostname}/`;
  } catch {
    return null;
  }
}

/**
 * Extract the clean hostname from a URL string.
 */
export function extractHostname(urlStr: string): string | null {
  try {
    return new URL(urlStr).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
