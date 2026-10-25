# Design reference

The visual system for AI Pitch Studio is modelled on the InstaLILY.ai style guide below. We borrow the **system** (monochrome base, one green accent, terminal and product-card motifs, eyebrow + period-ended headline anatomy), not InstaLILY's identity: no logo, lockups, product names or copy of theirs (see section 13).

## How AI Pitch Studio applies it

| Guide element | In this app |
|---|---|
| Monochrome base, white paper | `frontend/app/globals.css` tokens: `--bg` paper, `--panel` gray-50, `--line` gray-200, `--text` ink, `--muted` gray-500 |
| One green accent, small doses | `--green` for live/status dots and checks only; `--good` (deep green) for success text |
| Dark "product proof" surfaces | `.surface-dark` re-scopes the tokens; used for terminals, the self-correcting loop and the camera stage |
| Sans + mono | Geist Sans / Geist Mono via `next/font` |
| Eyebrow → H2. → lede | `SectionHeader` component; headlines end with a period |
| Pill buttons, `→` links | `.btn-primary` (ink pill), `.btn-ghost` (outline pill), `.link-arrow` |
| Terminal windows, ◆ glyphs | `Terminal` component (animated typing on the dashboard) |
| Zero-padded ordered points | `01 02 03` step markers on the create form and "How it works" |
| Status badges | `.badge`, `.badge-live` (green dot) |
| Pixel mark | `PixelMark` component: our own mic glyph drawn as square tiles |
| One orchestrated motion moment | Dashboard terminal types the Argon loop; sections fade up once on load; respects `prefers-reduced-motion` |

---

# InstaLILY.ai Style Replication Guide

Reference: https://www.instalily.ai (pages reviewed: Home, Lily, About, Press Kit, Products), October 2026.

## Read this first: what is confirmed vs. estimated

My fetcher returns each page's text, structure and asset URLs, but not its rendered CSS. So this guide separates two kinds of information:

- **Confirmed** items come directly from the page markup: layout order, component types, button labels, icon glyphs, image treatments, logo variants, copy patterns, and the tech stack (Next.js).
- **Estimated** items (exact hex codes, font family names, radii, spacing values) are marked `VERIFY`. They are sensible starting values that match the confirmed look (black and white base, green pixel accent, terminal motifs), but you should confirm them with the 5 minute DevTools check in Section 10 before treating them as exact.

---

## 1. Overall aesthetic in one paragraph

Engineering-flavored enterprise minimalism. A monochrome (black, white, grays) foundation, one green accent drawn from the pixel-tile logo, generous whitespace, and large declarative headlines. The personality comes from "developer artifacts" placed inside a marketing site: terminal windows, ASCII diagrams, code blocks, status badges, and realistic product UI cards (quotes, approvals, deployment dashboards). It reads like a technical product that also wants to look calm and trustworthy to operations executives.

---

## 2. Color

### Confirmed
- The brand mark exists only in **black** and **white** versions (wordmark, icon, pixel mark). The brand is fundamentally monochrome.
- The social share image is described as the petal mark "rendered as a grid of **green pixel tiles** on a **black background**." Green is the signature accent; black is the hero/feature surface.
- Customer logos ship in two versions each: a **black** version and a **color** version. Logos sit in grayscale by default and reveal brand color on hover.
- Photography (team photos, office, offsite) is real and full color.

### Estimated palette (VERIFY)

| Token | Hex (starting value) | Use |
|---|---|---|
| `--ink` | `#000000` | Headlines, primary button fill, dark sections |
| `--paper` | `#FFFFFF` | Main page background |
| `--gray-50` | `#F7F7F5` | Alternate section background, card fills |
| `--gray-200` | `#E5E5E3` | Hairline borders, dividers |
| `--gray-500` | `#6B6B6B` | Body copy secondary, captions, eyebrows |
| `--lily-green` | `#22C55E` | Pixel mark, status dots, "live" and checkmark states |
| `--lily-green-deep` | `#15803D` | Green text on white (meets contrast) |
| `--terminal-bg` | `#0A0A0A` | Terminal and code windows |

### Rules of use
- Keep 90%+ of any screen monochrome. Green appears in small, meaningful doses: status indicators, check marks, the pixel mark, success states.
- Never use green as a large background wash or gradient.
- Dark sections (black background, white text) are used for "product proof" moments: terminals, the pixel mark, the compounding loop.

---

## 3. Typography

### Confirmed
- The site runs on Next.js and uses its self-hosted font system (the `next-size-adjust` meta tag is present), so fonts are bundled locally rather than pulled from Google Fonts at runtime.
- Two type roles are clearly in use:
  1. A clean **sans-serif** for everything in the marketing layer.
  2. A **monospace** face for terminals, code blocks, version strings (`v3.0.6`), and data labels.

### Estimated families (VERIFY)
- Sans: a neo-grotesk. Good stand-ins: **Geist Sans**, **Inter**, or **Söhne** (paid).
- Mono: **Geist Mono**, **JetBrains Mono**, or **IBM Plex Mono**.

### Type scale (starting values)

| Role | Size (desktop) | Weight | Line height | Tracking |
|---|---|---|---|---|
| H1 hero | 64 to 80px | 500 to 600 | 1.0 to 1.05 | -0.03em |
| H2 section | 40 to 48px | 500 | 1.1 | -0.02em |
| H3 card / step | 20 to 24px | 500 | 1.25 | -0.01em |
| Eyebrow label | 13 to 14px | 500 | 1.4 | 0 (sentence case) |
| Body | 17 to 18px | 400 | 1.55 | 0 |
| Small / caption | 13 to 14px | 400 | 1.45 | 0 |
| Mono UI | 13 to 14px | 400 | 1.5 | 0 |

### Headline style (confirmed patterns)
- Headlines are short, declarative, and often **end with a period**: "About InstaLILY.", "Press kit.", "Logos and marks.", "Company facts."
- Two-beat closers: "Lily embeds. And she stays." / "Real work. Real outcomes."
- Hero H1 breaks onto two lines with the product name first: "Lily is the first / AI Forward Deployed Engineer".
- Sentence case everywhere. The only all-caps text is inside diagrams (BUILD, PROVE, GENERALIZE, FEEDBACK).

---

## 4. Layout and page rhythm

### Confirmed homepage section order
1. Dismissible announcement bar ("Announcing our $60M Series B →" with an × close)
2. Sticky top nav
3. Hero: H1, one-sentence subhead, "Scroll to explore" cue
4. Customer logo marquee (infinite loop; the list is duplicated in markup)
5. "How Lily works": 3 numbered steps
6. Platform: 4 numbered points (01 to 04)
7. Use cases: 5 image cards (eyebrow + H3 + one line)
8. "Works inside your systems": app icon row + 3 product UI mock cards
9. Compounding loop diagram (BUILD → PROVE → GENERALIZE → FEEDBACK)
10. Deployment options (cloud, on-premise, edge)
11. Stats carousel with case study links (01|05 pager, ‹ › arrows)
12. Tabbed comparison: "Traditional" vs "Forward-deployed AI"
13. Closing CTA band
14. Footer block: contact form, newsletter, locations, "Ask about InstaLILY on" AI links, link columns, legal line

### Section anatomy (repeat this everywhere)
```
[Eyebrow label]            small, gray, sentence case ("Platform", "Use cases")
[H2 headline.]             large, ink, often ends in a period
[One or two sentence lede] gray, max ~60ch
[Content: steps / cards / mock UI]
[Optional CTA pair]
```

### Grid and spacing (VERIFY)
- Max content width: ~1200 to 1280px, centered, 24px side padding on mobile.
- Section vertical padding: 96 to 128px desktop, 64px mobile.
- Mostly **left-aligned** text. Center alignment is reserved for the hero and the closing CTA band.
- 12-column grid; cards in 3-up or 5-up rows, collapsing to 1-up on mobile.

---

## 5. Buttons and links

### Confirmed labels and pairings
- Primary CTA: **"Book a demo"** (in nav, heroes, About). In the mobile menu it gets an arrow: "Book a demo→".
- Secondary CTAs: product links like "Meet Lily", "View all careers", "Forward deployed engineering".
- Inline text links use a trailing arrow: "Read case study →", "Meet Lily →", "See how FDE works →".
- Primary and secondary often appear as a **pair**: solid button + quieter link/outline button.
- In-product mock buttons: "Approve" / "Hold" (approval card), "Copy" (press kit boilerplate blocks), "Send" (contact form).

### Suggested CSS (VERIFY radius)
```css
.btn {
  display: inline-flex; align-items: center; gap: 0.4em;
  font: 500 15px/1 var(--font-sans);
  padding: 12px 20px;
  border-radius: 999px;            /* VERIFY: pill vs 6px */
  transition: background .15s, color .15s;
}
.btn-primary   { background: var(--ink);  color: var(--paper); }
.btn-primary:hover { background: #262626; }
.btn-secondary { background: transparent; color: var(--ink); border: 1px solid var(--gray-200); }
.btn-secondary:hover { border-color: var(--ink); }
.link-arrow::after { content: " →"; transition: transform .15s; display: inline-block; }
.link-arrow:hover::after { transform: translateX(3px); }
```

---

## 6. Lists and bullet styles

The site uses several distinct list treatments. Pick by content type:

| Pattern | Marker | Where it appears |
|---|---|---|
| Process steps | Large numerals `1 2 3` | "How Lily works" |
| Ordered points | Zero-padded `01 02 03 04` | Platform section, Lily page features |
| Roadmap | Status word: Now / Next / Then / Later + badge ("Shipped · v3.0.6", "In progress", "In research", "Planned") | Lily roadmap |
| Capability checklist | Plain bullets or check marks, one line each | "Everything in the box" (8 items) |
| Status list | `✓` green check per line | Terminal output ("✓ contracts", "✓ checkpoint") |
| Change log | `→` arrows ("Pricing schema changed → redeployed") | Deployment card |
| Do / Don't | Two side-by-side lists with headers "Do" and "Don't" | Press kit brand guidelines |
| Fact sheet | Label / value rows (definition list) | Press kit "Company facts" |

Rule: one line per bullet, starting with a verb or noun phrase, no trailing period on short items.

---

## 7. Graphics and imagery

### Confirmed motifs
1. **Pixel mark.** The logo drawn as a grid of square tiles. Used for product and app surfaces. Good for loaders, favicons, and hero art.
2. **Terminal windows.** Fake macOS-style windows with titles like `lily - rooftop-supply` or `macmini - zsh`, a prompt (`>` or `$`), a welcome line with a diamond glyph (`◆ Welcome to Lily!`), and helper text (`/help for help`, `? for shortcuts`).
3. **ASCII diagrams.** Monospace art using the glyph family `◆ ◇ ❖ ♦ ♢` plus `| / \ - v` for flows and timelines (a 3-day timeline with "✓ checkpoint" labels; an improvement loop).
4. **Code snippets** inside cards (short pseudo-functions like `fn quote(rfq) { ... }`).
5. **Product UI mock cards** built in HTML, not screenshots:
   - Quote card: line items with qty and price, total, a margin badge, "Within contract terms"
   - Human review card: timestamp, rule message, avatar initials ("JM"), Approve / Hold buttons
   - Deployment card: "Live · 142 days", metrics (Uptime 99.98%, Incidents 0, Services 11), service rows with version + "Stable" badge
6. **Enterprise app icons row** (SAP, NetSuite, Salesforce, HubSpot, Snowflake) as small square icons.
7. **Use case images**: framed `.webp` illustrations or product frames, one per industry card.
8. **Real team photography**: offsites, office shots. Their brand rules forbid AI-generated or AI-altered team photos.

### Badge style (suggested)
```css
.badge {
  font: 500 12px/1 var(--font-mono);
  padding: 4px 8px; border-radius: 999px;
  background: var(--gray-50); color: var(--gray-500);
  border: 1px solid var(--gray-200);
}
.badge--live::before {
  content: ""; width: 6px; height: 6px; border-radius: 50%;
  background: var(--lily-green); display: inline-block; margin-right: 6px;
}
```

### Terminal window (suggested)
```html
<div class="term">
  <div class="term-bar"><span></span><span></span><span></span><p>app - project</p></div>
  <pre>◆ Welcome!
/help for help · cwd: ~/project

&gt; generate last month's report

? for shortcuts</pre>
</div>
```
```css
.term { background: var(--terminal-bg); color: #EDEDED; border-radius: 12px; overflow: hidden; }
.term-bar { display: flex; gap: 6px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #222; }
.term-bar span { width: 10px; height: 10px; border-radius: 50%; background: #333; }
.term-bar p { margin: 0 auto; font: 12px var(--font-mono); color: #888; }
.term pre { margin: 0; padding: 20px; font: 14px/1.6 var(--font-mono); }
```

---

## 8. Navigation and footer

**Top nav (confirmed):** logo left; Products, Why InstaLILY, Solutions, Case Studies, Media, About; "Book a demo" button right. Each item opens a mega-menu of plain text links (no icons or descriptions). Mobile: hamburger revealing the same groups, CTA at the bottom.

**Footer (confirmed, top to bottom):**
1. "Contact us" form with three fields (Work email, Company, Note) and a Send button
2. "Stay in the loop" newsletter block linking to Substack
3. Locations list with a small "HQ" tag
4. "Ask about InstaLILY on" row of AI assistant icons (ChatGPT, Claude, Perplexity, Google AI Mode, Grok), each linking to a prefilled question. A distinctive, modern touch worth borrowing.
5. Link columns mirroring the nav groups, plus Legal
6. Social icons (LinkedIn, X, Instagram, YouTube, Substack) and copyright line

---

## 9. Motion and interaction (confirmed from markup, details VERIFY)

- Logo marquee scrolls continuously; logos swap from black to color on hover.
- Stats carousel with a `01|05` counter and ‹ › arrows.
- Tabs toggle between "Traditional" and "Forward-deployed AI" comparison states.
- Terminal and product cards likely animate (typing, status changing to "Shipped to production"). Keep this to one orchestrated moment per section and respect `prefers-reduced-motion`.

---

## 10. Voice and copy patterns

- Short declarative sentences. Plain verbs: learns, builds, runs, ships, stays.
- Contrast pairs: "weeks, not quarters", "real work, not demos", "No rip-and-replace. No migration."
- Outcome numbers in proof sections: a metric first, then a one-line explanation, then "Read case study →".
- Product names use title case with ™ where trademarked; the company name has a deliberate mixed case.
- Sentence-case eyebrow labels name the section topic in one or two words.

---

## 11. Verify the exact values yourself (5 minutes)

1. Open the homepage in Chrome, right-click a headline, **Inspect**.
2. In the **Computed** tab, read `font-family`, `font-size`, `font-weight`, `letter-spacing`. Repeat for body text, a button, and a terminal line.
3. Open DevTools **⋮ > More tools > CSS Overview > Capture overview**. It lists every color, font, and border-radius used on the page. Replace the `VERIFY` values in Sections 2, 3, and 5.
4. In the **Network** tab filtered to "Font", see the actual font file names.
5. Check `:root` in the **Styles** pane for CSS custom properties; Next.js sites often expose the full token set there.

---

## 12. Starter token file

```css
:root {
  /* color: VERIFY against CSS Overview */
  --ink: #000000;
  --paper: #FFFFFF;
  --gray-50: #F7F7F5;
  --gray-200: #E5E5E3;
  --gray-500: #6B6B6B;
  --lily-green: #22C55E;
  --lily-green-deep: #15803D;
  --terminal-bg: #0A0A0A;

  /* type: VERIFY family names */
  --font-sans: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, "SFMono-Regular", monospace;

  /* shape and space */
  --radius-card: 16px;
  --radius-btn: 999px;
  --section-pad: clamp(64px, 10vw, 128px);
  --container: 1240px;
}
@media (prefers-color-scheme: dark) {
  :root { --ink: #FFFFFF; --paper: #000000; --gray-50: #111111; --gray-200: #262626; --gray-500: #A3A3A3; }
}
```

---

## 13. Keep it yours

Borrow the system (monochrome base, single green accent, terminal and UI-card motifs, period-ended headlines, eyebrow + H2 anatomy), not the identity. InstaLILY's own guidelines ask that nobody recreate or approximate their logo or type lockups, and their product names are trademarked. Swap in your own mark (a pixel-tile version of your logo works well with this style), your own accent color if you want distance, and your own copy.
