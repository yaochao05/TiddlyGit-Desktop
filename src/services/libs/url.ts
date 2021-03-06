export function extractDomain(fullUrl: string): string | undefined {
  const matches = fullUrl.match(/^https?:\/\/([^#/?]+)(?:[#/?]|$)/i);
  const domain = matches !== null ? matches[1] : undefined;
  // https://stackoverflow.com/a/9928725
  return typeof domain === 'string' ? domain.replace(/^(www\.)/, '') : undefined;
}

/**
 * https://stackoverflow.com/a/14645182
 */
export function isSubdomain(url: string): boolean {
  const regex = /^([a-z]+:\/{2})?((?:[\w-]+\.){2}\w+)$/;
  return url.match(regex) === null;
}

export function equivalentDomain(domain?: string): string | undefined {
  if (typeof domain !== 'string') {
    return;
  }
  let equivalent = domain;
  const prefixes = ['www', 'app', 'login', 'go', 'accounts', 'open'];
  // app.portcast.io ~ portcast.io
  // login.xero.com ~ xero.com
  // go.xero.com ~ xero.com
  // accounts.google.com ~ google.com
  // open.spotify.com ~ spotify.com
  // remove one by one not to break domain
  prefixes.forEach((prefix) => {
    // check if subdomain, if not return the domain
    if (isSubdomain(equivalent)) {
      // https://stackoverflow.com/a/9928725
      const regex = new RegExp(`^(${prefix}.)`);
      equivalent = equivalent.replace(regex, '');
    }
  });
  return equivalent;
}

export function isInternalUrl(url: string, currentInternalUrls: Array<string | void>): boolean {
  // google have a lot of redirects after logging in
  // so assume any requests made after 'accounts.google.com' are internals
  for (const currentInternalUrl of currentInternalUrls) {
    if (typeof currentInternalUrl === 'string' && currentInternalUrl.startsWith('https://accounts.google.com')) {
      return true;
    }
  }
  // external links sent in Google Meet meeting goes through this link first
  // https://meet.google.com/linkredirect?authuser=1&dest=https://something.com
  if (url.startsWith('https://meet.google.com/linkredirect')) {
    return false;
  }
  const domain = equivalentDomain(extractDomain(url));
  const matchedInternalUrl = currentInternalUrls.find((internalUrl: any) => {
    const internalDomain = equivalentDomain(extractDomain(internalUrl));
    // Ex: music.yandex.ru => passport.yandex.ru?retpath=....music.yandex.ru
    // https://github.com/quanglam2807/webcatalog/issues/546#issuecomment-586639519
    if (typeof internalDomain === 'string' && (domain === 'clck.yandex.ru' || domain === 'passport.yandex.ru')) {
      return url.includes(internalDomain);
    }
    // domains match
    return domain === internalDomain;
  });
  return Boolean(matchedInternalUrl);
}
