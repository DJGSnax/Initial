/**
 * Seeds demo content: collections, articles and prompts that match the /demo host app.
 * Safe to re-run: skips anything whose slug or name already exists.
 */
import { eq } from "drizzle-orm";
import { closeDb, db, initDb } from "./db/client";
import { articles, collections, prompts } from "./db/schema";
import { htmlToText, renderMarkdown } from "./lib/markdown";
import type { PromptDefinition } from "../shared/types";

const COLLECTIONS = [
  { slug: "getting-started", name: "Getting started", description: "Set up your workspace and learn the basics.", icon: "rocket", position: 0 },
  { slug: "projects", name: "Projects", description: "Create, organise and export projects.", icon: "folder", position: 1 },
  { slug: "billing", name: "Billing & plans", description: "Payments, invoices and plan changes.", icon: "card", position: 2 },
  { slug: "team", name: "Team & permissions", description: "Invite people and manage roles.", icon: "users", position: 3 },
];

const ARTICLES: { collection: string; slug: string; title: string; summary: string; tags: string[]; contextPaths?: string[]; body: string }[] = [
  {
    collection: "getting-started",
    slug: "quick-start",
    title: "Quick start: your first 10 minutes",
    summary: "Create a project, invite a teammate and learn where everything lives.",
    tags: ["onboarding", "basics"],
    contextPaths: ["/demo"],
    body: `Welcome to Northwind. This guide gets you from an empty workspace to a working project.

## 1. Create your first project
Click **New project** on the dashboard, give it a name and pick a template. Templates come with example tasks you can delete later.

## 2. Invite a teammate
Go to **Team** in the top navigation and enter their email under *Invite by email*. They get a link that is valid for 7 days. See [Inviting teammates](/help/a/invite-teammates).

## 3. Import existing work
Use **Import data** on the dashboard to bring in a CSV from a spreadsheet or another tool. Columns are matched automatically and you can fix mappings before importing.

> [!TIP]
> Press <kbd>?</kbd> anywhere in the app to see keyboard shortcuts.`,
  },
  {
    collection: "getting-started",
    slug: "import-data",
    title: "Importing data from a CSV",
    summary: "Bring tasks and projects in from spreadsheets or other tools.",
    tags: ["import", "csv", "migration"],
    contextPaths: ["/demo"],
    body: `You can import projects and tasks from any CSV file.

## Prepare your file
- The first row must contain column headers.
- Required columns: **Title**. Optional: Due date, Assignee, Status, Project.
- Dates work best as \`YYYY-MM-DD\`.

## Run the import
1. On the dashboard click **Import data**.
2. Choose your CSV (max 20 MB, 50,000 rows).
3. Check the column mapping. Unmatched columns are skipped.
4. Click **Import**. Large files take a minute; you'll get a notification when it's done.

## Common problems
**"Unrecognised date format"**: convert dates to \`YYYY-MM-DD\` and retry.
**Assignees not matched**: assignees are matched by email, so invite the person first.`,
  },
  {
    collection: "projects",
    slug: "create-project",
    title: "Creating and organising projects",
    summary: "Templates, folders, archiving and project settings.",
    tags: ["projects"],
    contextPaths: ["/demo/projects"],
    body: `Projects hold tasks, files and discussions.

## Create a project
Click **Create project** on the Projects page. Choose **Blank** or a template such as *Website launch* or *Client onboarding*.

## Organise projects
- Drag projects into folders from the sidebar.
- Star a project to pin it to the top.
- Archive finished projects from **Project settings → Archive**. Archived projects are read-only and don't count toward plan limits.

## Project limits
Trial and Starter plans include 5 active projects. Team and Business have no limit.`,
  },
  {
    collection: "projects",
    slug: "export-csv",
    title: "Exporting projects to CSV",
    summary: "Download tasks as a CSV for reporting or backup.",
    tags: ["export", "csv", "reports"],
    contextPaths: ["/demo/projects"],
    body: `You can export any project, or all projects at once.

1. Open **Projects**.
2. Click **Export CSV**.
3. Pick the projects and fields to include, then click **Download**.

Exports include task title, status, assignee, due date, created date and custom fields. Comments and attachments are not included; use a full workspace backup for those (Business plan).

> [!NOTE]
> Exports over 10,000 rows are emailed to you as a download link instead of downloading directly.`,
  },
  {
    collection: "billing",
    slug: "upgrade-plan",
    title: "Upgrading or changing your plan",
    summary: "Compare plans and switch at any time. Changes are prorated.",
    tags: ["billing", "plans", "upgrade", "trial"],
    contextPaths: ["/demo/billing"],
    body: `You can upgrade, downgrade or cancel at any time from **Billing**.

| Plan | Price | Projects | Members |
| --- | --- | --- | --- |
| Starter | $8 / member / month | 5 | up to 10 |
| Team | $14 / member / month | Unlimited | Unlimited |
| Business | $24 / member / month | Unlimited | Unlimited, plus SSO |

## How proration works
When you upgrade mid-cycle you pay the difference for the remaining days. Downgrades take effect at the end of the current billing period.

## Ending a trial
Your trial converts only when you add a card and pick a plan. Nothing is charged automatically.`,
  },
  {
    collection: "billing",
    slug: "card-declined",
    title: "Why was my card declined?",
    summary: "Fix declined payments: billing address, 3-D Secure and bank blocks.",
    tags: ["billing", "payment", "card", "declined", "error"],
    contextPaths: ["/demo/billing"],
    body: `Most declines come from the card issuer, not from us. Try these in order:

1. **Check the billing address and postcode.** They must match what your bank has on file exactly.
2. **Complete the 3-D Secure check.** Some banks show a pop-up or send an app notification. Disable pop-up blockers and try again.
3. **Ask your bank to allow the charge.** Corporate cards often block new merchants or international payments. The charge appears as *NORTHWIND PROJECTS*.
4. **Try a different card.** Prepaid and some virtual cards aren't supported.

If it still fails after these steps, contact support with the time of the attempt (never send your card number).`,
  },
  {
    collection: "billing",
    slug: "invoices",
    title: "Downloading invoices and receipts",
    summary: "Find past invoices and add tax or company details.",
    tags: ["billing", "invoice", "receipt", "vat"],
    contextPaths: ["/demo/billing"],
    body: `Invoices are under **Billing → Invoices**. Click any invoice to download a PDF.

## Add company or tax details
Under **Billing → Details** add your company name, address and VAT/GST number. New invoices include them; past invoices can be regenerated once from the invoice menu.`,
  },
  {
    collection: "team",
    slug: "invite-teammates",
    title: "Inviting teammates",
    summary: "Send invites, resend expired links and fix invites that don't arrive.",
    tags: ["team", "invite", "members", "email"],
    contextPaths: ["/demo/settings/*"],
    body: `Go to **Team**, enter an email address under *Invite by email* and click **Send invite**.

## The invite didn't arrive
- Ask them to check spam and any "Promotions" tab.
- Invites expire after **7 days**. Click **Resend** next to the pending invite.
- Some company mail servers block links from new senders. Ask IT to allow \`notifications@northwind.example\`.
- You can also copy the invite link from the pending invite menu and share it directly.

## Seat limits
On Starter you can have up to 10 members. Pending invites count toward the limit until they expire or are revoked.

## Sending many invites
Clicking **Send invite** repeatedly doesn't send duplicates. If nothing seems to happen, check whether the address is already a member or has a pending invite.`,
  },
  {
    collection: "team",
    slug: "roles-permissions",
    title: "Roles and permissions",
    summary: "What owners, admins, members and guests can do.",
    tags: ["team", "roles", "permissions", "admin"],
    contextPaths: ["/demo/settings/*"],
    body: `Every member has one role:

- **Owner**: everything, including billing and deleting the workspace. There's always at least one owner.
- **Admin**: manage members, projects and settings, but not billing.
- **Member**: create and edit projects they belong to.
- **Guest**: view and comment on projects they're invited to. Guests are free.

Change a role from **Team**, using the menu next to each person.`,
  },
  {
    collection: "getting-started",
    slug: "privacy-analytics",
    title: "How we use in-app analytics",
    summary: "What the help widget records, and what it never records.",
    tags: ["privacy", "gdpr", "analytics"],
    body: `The help widget records which help articles are read and which in-app tips are shown, so we can improve them.

**What we record (only with your consent):** a random session id, a pseudonymous account id that cannot be reversed into your name or email, the page path (without query strings), and coarse device type.

**What we never record:** names, email addresses, IP addresses, what you type into forms, or full URLs.

Data is deleted automatically after 180 days. You can ask for your data to be exported or deleted at any time.`,
  },
];

const step = (p: Partial<PromptDefinition["steps"][0]> & { id: string }) => ({ title: "", body: "", ...p });

const PROMPTS: { name: string; type: "tour" | "hotspot" | "banner" | "tooltip" | "modal"; status: "live"; priority: number; definition: PromptDefinition }[] = [
  {
    name: "Welcome tour for new trial admins",
    type: "tour",
    status: "live",
    priority: 10,
    definition: {
      steps: [
        step({ id: "s1", title: "Welcome to Northwind 👋", body: "Here's a 30-second tour of the three things most teams do first." }),
        step({ id: "s2", selector: '[data-kb-id="new-project"]', title: "Start a project", body: "Projects hold your tasks and files. Templates give you a head start.", placement: "bottom", spotlight: true }),
        step({ id: "s3", selector: '[data-kb-id="import-data"]', title: "Bring your data", body: "Coming from a spreadsheet? Import a CSV and we'll map the columns.", articleSlug: "import-data", spotlight: true }),
        step({ id: "s4", selector: '[data-kb-id="nav-team"]', title: "Invite your team", body: "Northwind works best with your teammates in it.", ctaLabel: "Invite people", ctaUrl: "/demo/settings/team", spotlight: true }),
      ],
      targeting: { urlRules: [{ op: "equals", value: "/demo" }], traitRules: [{ key: "plan", op: "eq", value: "trial" }], audience: "identified" },
      trigger: { type: "delay", delayMs: 1200 },
      frequency: { mode: "until_dismissed" },
      theme: { dismissible: true },
    },
  },
  {
    name: "Export CSV hotspot",
    type: "hotspot",
    status: "live",
    priority: 0,
    definition: {
      steps: [step({ id: "s1", selector: '[data-kb-id="export-csv"]', title: "New: export to CSV", body: "Download any project's tasks for reporting or backup.", articleSlug: "export-csv", placement: "bottom" })],
      targeting: { urlRules: [{ op: "starts_with", value: "/demo/projects" }], traitRules: [], audience: "all" },
      trigger: { type: "page_load" },
      frequency: { mode: "until_dismissed" },
      theme: { beacon: true, dismissible: true },
    },
  },
  {
    name: "Trial ending banner",
    type: "banner",
    status: "live",
    priority: 5,
    definition: {
      steps: [step({ id: "s1", title: "11 days left in your trial.", body: "Pick a plan any time. Nothing is charged automatically.", ctaLabel: "Compare plans", ctaUrl: "/demo/billing" })],
      targeting: { urlRules: [{ op: "starts_with", value: "/demo/projects" }], traitRules: [{ key: "plan", op: "eq", value: "trial" }], audience: "all" },
      trigger: { type: "page_load" },
      frequency: { mode: "once_per_session" },
      theme: { position: "top", dismissible: true },
    },
  },
  {
    name: "Upgrade button help on hesitation",
    type: "tooltip",
    status: "live",
    priority: 3,
    definition: {
      steps: [step({ id: "s1", selector: '[data-kb-id="plan-select"]', title: "Not sure which plan?", body: "Most teams under 10 people start on **Starter**. You can switch any time and we prorate the difference.", articleSlug: "upgrade-plan", placement: "right" })],
      targeting: { urlRules: [{ op: "equals", value: "/demo/billing" }], traitRules: [], audience: "all" },
      trigger: { type: "idle", idleMs: 15000 },
      frequency: { mode: "once_per_session" },
      theme: { dismissible: true },
    },
  },
];

async function main() {
  await initDb();
  const colIds: Record<string, number> = {};
  for (const c of COLLECTIONS) {
    const existing = await db().query.collections.findFirst({ where: eq(collections.slug, c.slug) });
    colIds[c.slug] = existing?.id ?? (await db().insert(collections).values(c).returning())[0].id;
  }
  let n = 0;
  for (const [i, a] of ARTICLES.entries()) {
    const exists = await db().query.articles.findFirst({ where: eq(articles.slug, a.slug), columns: { id: true } });
    if (exists) continue;
    const bodyHtml = renderMarkdown(a.body);
    await db().insert(articles).values({
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      bodyMd: a.body,
      bodyHtml,
      bodyText: htmlToText(bodyHtml),
      status: "published",
      collectionId: colIds[a.collection],
      tags: a.tags,
      keywords: a.tags.join(" "),
      contextPaths: a.contextPaths ?? [],
      position: i,
      publishedAt: new Date(),
    });
    n++;
  }
  let pN = 0;
  for (const p of PROMPTS) {
    const exists = await db().query.prompts.findFirst({ where: eq(prompts.name, p.name), columns: { id: true } });
    if (exists) continue;
    await db().insert(prompts).values(p);
    pN++;
  }
  console.log(`Seeded ${COLLECTIONS.length} collections, ${n} new articles, ${pN} new prompts.`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
