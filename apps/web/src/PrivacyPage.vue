<script setup lang="ts">
import BrandWordmark from "./BrandWordmark.vue";
import ThemeToggle from "./ThemeToggle.vue";
</script>

<template>
  <main class="privacy-page">
    <header>
      <ThemeToggle />
      <a class="brand-link" href="/" aria-label="Streamface home"><BrandWordmark /></a>
      <p class="eyebrow">PRIVACY NOTICE</p>
      <h2>Privacy at Streamface</h2>
      <p class="intro">
        Streamface is a free, non-commercial project for creating stream overlays with an AT
        Protocol account. Most information you save through Streamface lives publicly in your own
        Personal Data Server (PDS), not in a Streamface database.
      </p>
      <p class="updated">Last updated: 11 October 2026</p>
    </header>

    <section aria-labelledby="operator-title">
      <h3 id="operator-title">Who runs Streamface</h3>
      <address>
        <strong>Julian Müller</strong><br />
        Email: <a href="mailto:schnullerpip@gmail.com">schnullerpip@gmail.com</a><br />
        Bluesky: <a href="https://bsky.app/profile/fettstorch.dev">@fettstorch.dev</a>
      </address>
    </section>

    <section aria-labelledby="pds-title">
      <h3 id="pds-title">Information stored in your PDS</h3>
      <p>
        Your overlay settings, commands, preferences, custom modules, and uploaded media are saved
        as public AT Protocol records or blobs in the PDS connected to your account. Anyone who
        knows your account identifier may be able to read them. Your PDS provider controls that
        service's storage, retention, federation, and security practices. Please consult the privacy
        notice of your chosen PDS provider for those details.
      </p>
      <p>
        Streamface reads these public records to display your overlays and writes or deletes them
        when you use the corresponding controls. You can manage this information through Streamface
        or your PDS.
      </p>
    </section>

    <section aria-labelledby="service-title">
      <h3 id="service-title">Information processed by Streamface</h3>
      <p>To provide and protect the hosted service, Streamface processes:</p>
      <ul>
        <li>
          your AT Protocol handle, DID, public profile, OAuth session, and a signed login cookie;
        </li>
        <li>
          temporary overlay and drawing data while sending it between your connected browser
          sources; and
        </li>
        <li>
          technical logs such as timestamps, request IDs, requested routes, response status, and
          limited diagnostic information. Credentials and tokens are redacted from structured logs.
        </li>
      </ul>
      <p>
        This processing is necessary to provide the features you request and serves the legitimate
        interests of operating, securing, and troubleshooting Streamface. Streamface does not use
        advertising cookies, behavioural analytics, automated decision-making, or sell personal
        information.
      </p>
    </section>

    <section aria-labelledby="services-title">
      <h3 id="services-title">Other services</h3>
      <p>
        Depending on the features you use, information is also exchanged with your PDS and AT
        Protocol services, Bluesky's public API, Stream.place, GIPHY, and the infrastructure
        provider hosting Streamface. These services process information under their own terms and
        privacy notices. GIPHY searches and media requests are made directly from your browser.
      </p>
    </section>

    <section aria-labelledby="retention-title">
      <h3 id="retention-title">Retention</h3>
      <p>
        Temporary relay state is kept in memory only while it is needed and is removed after
        inactivity. Public configuration may be cached for up to about one inactive hour. Logging
        out removes the browser cookie but does not currently delete the server-side OAuth session
        or information stored in your PDS. Streamface does not yet have an automatic deletion period
        for OAuth sessions or operational logs; you can request their deletion using the contact
        details above.
      </p>
    </section>

    <section aria-labelledby="rights-title">
      <h3 id="rights-title">Your choices and rights</h3>
      <p>
        You may ask what personal information Streamface holds about you and request correction,
        deletion, restriction, or an export where applicable. You may also object to processing and
        lodge a complaint with your competent data protection authority. Some requests concerning
        public PDS information must be directed to your PDS provider.
      </p>
      <p>
        For a privacy request, email
        <a href="mailto:schnullerpip@gmail.com">schnullerpip@gmail.com</a> or contact
        <a href="https://bsky.app/profile/fettstorch.dev">@fettstorch.dev</a> on Bluesky.
      </p>
    </section>

    <footer><a href="/">Back to Streamface</a></footer>
  </main>
</template>

<style scoped>
.privacy-page {
  max-width: 800px;
}
.brand-link {
  display: block;
  width: min(580px, 100%);
  color: inherit;
  text-decoration: none;
}
.privacy-page header h2 {
  margin: 30px 0 12px;
  color: inherit;
  font-size: clamp(1.8rem, 5vw, 2.7rem);
  letter-spacing: -0.02em;
  text-transform: none;
}
.updated {
  color: #68738a;
  font-size: 0.85em;
}
section > h3 {
  margin-bottom: 12px;
  font-size: 1.45em;
}
p,
li {
  line-height: 1.58;
}
li + li {
  margin-top: 8px;
}
address {
  padding: 18px 20px;
  border: 1px solid #ccd4e5;
  border-radius: 14px;
  background: #f7f9ff;
  font-style: normal;
  line-height: 1.6;
}
a {
  color: #334f9b;
  text-underline-offset: 3px;
}
footer {
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid #cad2e4;
}
:global(html[data-theme="dark"]) address {
  border-color: #414a5d;
  background: #191d25;
}
:global(html[data-theme="dark"]) a {
  color: #c2ceff;
}
</style>
