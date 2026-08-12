// Minimal Document stand-in for the detectors' DOM fallback.
//
// The detectors only ever call querySelector/querySelectorAll and getAttribute,
// so a handful of extracted signals is enough to exercise the real code in Node
// — no browser and no second copy of the detection logic.

function element(attributes) {
  return {
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    textContent: attributes.textContent ?? '',
  };
}

/**
 * @param {{links?: string[], attrs?: Record<string,string>[], metas?: {name?: string, property?: string, content: string}[], href?: string}} signals
 */
export function stubDocument(signals = {}) {
  const links = (signals.links || []).map((href) => element({ href }));
  const attrs = (signals.attrs || []).map((attributes) => element(attributes));
  const metas = (signals.metas || []).map((meta) =>
    element({ name: meta.name ?? null, property: meta.property ?? null, content: meta.content })
  );

  function matches(selector) {
    if (selector === 'a[href]') return links;
    if (selector === 'meta[content]') return metas;
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const attribute = selector.slice(1, -1);
      return attrs.filter((el) => el.getAttribute(attribute) !== null);
    }
    return [];
  }

  return {
    querySelectorAll: (selector) => matches(selector),
    querySelector: (selector) => matches(selector)[0] || null,
    defaultView: signals.href ? { location: { href: signals.href } } : undefined,
  };
}

/** Pull the same signals out of a live Playwright page. */
export const EXTRACT_SIGNALS = `(() => ({
  href: location.href,
  links: Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')).filter(Boolean).slice(0, 400),
  attrs: Array.from(document.querySelectorAll('[data-token-address],[data-mint],[data-address],[data-contract-address],[data-ca]')).map((el) => {
    const out = {};
    for (const name of ['data-token-address','data-mint','data-address','data-contract-address','data-ca']) {
      const value = el.getAttribute(name);
      if (value) out[name] = value;
    }
    return out;
  }),
  metas: Array.from(document.querySelectorAll('meta[content]')).map((m) => ({
    name: m.getAttribute('name'), property: m.getAttribute('property'), content: m.getAttribute('content'),
  })),
}))()`;
