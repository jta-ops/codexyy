export type Product = {
  slug: string
  name: string
  shortName: string
  color: string
  rgb: string
  eyebrow: string
  headline: string
  accentLine: string
  description: string
  summary: string
  price: string
  cadence: string
  priceDetail: string
  command?: string
  features: Array<{ title: string; description: string }>
  steps: Array<{ title: string; description: string }>
  preview: string[]
}

export const PRODUCTS: Product[] = [
  {
    slug: 'deploy', name: 'Codexyy Deploy', shortName: 'Deploy', color: '#FF6B35', rgb: '255,107,53',
    eyebrow: 'From repository to production', headline: 'Ship the thing.', accentLine: 'Keep your momentum.',
    description: 'Turn a Codexyy repository into a live application with preview environments, custom domains, readable logs, and one-click rollbacks.',
    summary: 'Deployments, previews, domains, logs, and rollbacks.', price: '$7', cadence: '/ project / month', priceDetail: 'One project and a Codexyy subdomain will always be free.', command: 'cxy deploy',
    features: [
      { title: 'One-command deploys', description: 'Publish the active repository without leaving the agent or terminal.' },
      { title: 'Branch previews', description: 'Every branch gets an isolated URL before it reaches production.' },
      { title: 'Custom domains', description: 'Connect a domain with automatically managed HTTPS.' },
      { title: 'Readable build logs', description: 'Follow every build step and open failures directly in the agent.' },
      { title: 'Instant rollback', description: 'Restore any healthy deployment without rebuilding it.' },
      { title: 'Environment secrets', description: 'Keep production configuration encrypted and separate from source.' },
      { title: 'Runtime metrics', description: 'See traffic, failures, latency, and resource consumption together.' },
      { title: 'Agent-assisted recovery', description: 'Investigate a failed deployment and prepare the fix in one flow.' },
    ],
    steps: [
      { title: 'Connect a repository', description: 'Choose the branch, framework, and build command.' },
      { title: 'Review the preview', description: 'Test the generated URL before promoting it.' },
      { title: 'Promote with confidence', description: 'Ship, monitor, or roll back from the same timeline.' },
    ], preview: ['build queued', 'preview ready', 'production healthy'],
  },
  {
    slug: 'teams', name: 'Codexyy Teams', shortName: 'Teams', color: '#A78BFA', rgb: '167,139,250',
    eyebrow: 'Build together without losing control', headline: 'One workspace.', accentLine: 'Everyone aligned.',
    description: 'Bring repositories, agent tasks, permissions, usage, and approvals into a shared workspace designed for real development teams.',
    summary: 'Collaboration, permissions, approvals, SSO, and team billing.', price: '$12', cadence: '/ member / month', priceDetail: 'A two-person workspace is free.',
    features: [
      { title: 'Shared workspaces', description: 'Keep repositories, prompts, tasks, and product context together.' },
      { title: 'Roles and permissions', description: 'Control who can view, edit, approve, deploy, and manage billing.' },
      { title: 'Agent task assignment', description: 'Hand work between people and agents without losing the thread.' },
      { title: 'Protected branches', description: 'Require review before automated or human changes land.' },
      { title: 'Shared instructions', description: 'Apply team conventions to every Codexyy agent session.' },
      { title: 'Usage budgets', description: 'Set limits by member, model, repository, or workspace.' },
      { title: 'Audit history', description: 'Understand who requested, approved, and published every change.' },
      { title: 'SSO for Business', description: 'Connect company identity and domain-based access controls.' },
    ],
    steps: [
      { title: 'Create a workspace', description: 'Bring existing Codexyy repositories with you.' },
      { title: 'Invite the team', description: 'Assign clear roles, budgets, and approval rules.' },
      { title: 'Ship as one unit', description: 'Track human and agent work from request to release.' },
    ], preview: ['task assigned', 'diff approved', 'release shared'],
  },
  {
    slug: 'review', name: 'Codexyy Review', shortName: 'Review', color: '#E2E2EC', rgb: '226,226,236',
    eyebrow: 'Understand every change before it lands', headline: 'Review the risk.', accentLine: 'Keep the progress.',
    description: 'Get a focused AI review of local or proposed changes, including bugs, affected tests, security concerns, and selectable fixes.',
    summary: 'AI reviews, bug detection, tests, and suggested fixes.', price: '$9', cadence: '/ month', priceDetail: 'Ten complete reviews are included free each month.', command: 'cxy review',
    features: [
      { title: 'Plain-language diffs', description: 'Explain what changed, why it matters, and what could break.' },
      { title: 'Bug detection', description: 'Find edge cases, incorrect assumptions, and unsafe behavior.' },
      { title: 'Test impact', description: 'Identify affected tests and generate the missing coverage.' },
      { title: 'Selectable patches', description: 'Apply one suggested fix without accepting unrelated edits.' },
      { title: 'Repository rules', description: 'Review against project-specific architecture and conventions.' },
      { title: 'Confidence levels', description: 'Separate high-confidence findings from exploratory suggestions.' },
      { title: 'Push approval', description: 'Show the final diff before cxy publishes anything.' },
      { title: 'Shareable reports', description: 'Give teammates a concise record of findings and decisions.' },
    ],
    steps: [
      { title: 'Scan the diff', description: 'Review reads only the files and context needed for the change.' },
      { title: 'Choose the fixes', description: 'Accept, reject, or discuss every suggestion separately.' },
      { title: 'Approve the result', description: 'Publish only after the final visible diff looks right.' },
    ], preview: ['2 bugs found', '3 tests suggested', 'diff ready'],
  },
  {
    slug: 'automate', name: 'Codexyy Automate', shortName: 'Automate', color: '#FFE14D', rgb: '255,225,77',
    eyebrow: 'Reliable agent work on a schedule', headline: 'Routine work.', accentLine: 'Handled.',
    description: 'Create scheduled and event-driven agent jobs with approval gates, retries, run histories, and strict model-spending limits.',
    summary: 'Scheduled agent jobs, triggers, retries, and approval gates.', price: '$10', cadence: '/ month', priceDetail: 'Includes 1,000 automation run-minutes.', command: 'cxy automate create',
    features: [
      { title: 'Schedules and triggers', description: 'Run hourly, daily, on a repository change, or from a webhook.' },
      { title: 'Dependency maintenance', description: 'Prepare safe update branches with release notes and tests.' },
      { title: 'Changelog generation', description: 'Turn merged work into accurate release summaries.' },
      { title: 'Approval gates', description: 'Pause before changes, deployments, emails, or other external actions.' },
      { title: 'Automatic retries', description: 'Retry transient provider and network failures with backoff.' },
      { title: 'Reusable templates', description: 'Start from Codexyy-maintained workflows or create your own.' },
      { title: 'Run timelines', description: 'See every step, tool action, output, and retry in order.' },
      { title: 'Hard spending limits', description: 'Cap runtime and model use before the job begins.' },
    ],
    steps: [
      { title: 'Choose a trigger', description: 'Pick a schedule, repository event, webhook, or API call.' },
      { title: 'Set the boundaries', description: 'Select instructions, limits, and required approvals.' },
      { title: 'Review every run', description: 'Keep outputs, diffs, and failures in one searchable timeline.' },
    ], preview: ['trigger received', 'approval requested', 'run complete'],
  },
  {
    slug: 'workspaces', name: 'Codexyy Workspaces', shortName: 'Workspaces', color: '#526DFF', rgb: '82,109,255',
    eyebrow: 'A ready-to-code machine in seconds', headline: 'Open a workspace.', accentLine: 'Start building.',
    description: 'Launch an isolated cloud development environment with your repository, Codexyy agent, browser terminal, and model access already connected.',
    summary: 'Cloud environments with the Codexyy agent preinstalled.', price: '$0.12', cadence: '/ active hour', priceDetail: 'Monthly starter hours are included free.', command: 'cxy workspace open',
    features: [
      { title: 'Instant Linux environments', description: 'Start from a clean, reproducible development image.' },
      { title: 'Agent preinstalled', description: 'Codexyy and cxy are configured before the workspace opens.' },
      { title: 'Browser terminal', description: 'Work from any machine without rebuilding your toolchain.' },
      { title: 'Persistent snapshots', description: 'Pause a workspace and return to the exact same state.' },
      { title: 'Repository isolation', description: 'Keep each project and its credentials in a separate boundary.' },
      { title: 'Shareable sessions', description: 'Invite a teammate to the same running environment.' },
      { title: 'Automatic sleep', description: 'Stop compute charges when a workspace becomes inactive.' },
      { title: 'Continue locally', description: 'Bring work home using the same cxy repository workflow.' },
    ],
    steps: [
      { title: 'Pick a repository', description: 'Codexyy detects the language and recommended workspace image.' },
      { title: 'Open the environment', description: 'The terminal, agent, and files arrive already connected.' },
      { title: 'Pause or publish', description: 'Save the state, push the changes, or deploy the result.' },
    ], preview: ['image ready', 'repository mounted', 'agent connected'],
  },
  {
    slug: 'memory', name: 'Codexyy Memory', shortName: 'Memory', color: '#FF4FD8', rgb: '255,79,216',
    eyebrow: 'Project context that survives the session', headline: 'Your project remembers.', accentLine: 'You stay in control.',
    description: 'Give the agent a durable understanding of architecture, decisions, conventions, unfinished work, and the reasoning behind the code.',
    summary: 'Persistent project knowledge, decisions, and session history.', price: '$8', cadence: '/ month', priceDetail: 'Basic pinned project notes remain free.',
    features: [
      { title: 'Architecture map', description: 'Keep a living picture of services, files, dependencies, and ownership.' },
      { title: 'Decision history', description: 'Record what the team chose, why, and which alternatives were rejected.' },
      { title: 'Project conventions', description: 'Remember naming, testing, deployment, and review expectations.' },
      { title: 'Session continuity', description: 'Resume unfinished work without reconstructing the entire conversation.' },
      { title: 'Why-this-exists answers', description: 'Connect current code to the decision that created it.' },
      { title: 'Pin and correct', description: 'Promote trusted facts and fix an inaccurate memory immediately.' },
      { title: 'Private boundaries', description: 'Memory never crosses repositories or workspaces unless invited.' },
      { title: 'Markdown export', description: 'Take the complete project memory with you at any time.' },
    ],
    steps: [
      { title: 'Capture useful context', description: 'Codexyy proposes durable facts after meaningful work.' },
      { title: 'Approve the memory', description: 'Nothing becomes trusted project context silently.' },
      { title: 'Use it everywhere', description: 'Future sessions begin with the decisions that matter.' },
    ], preview: ['decision recorded', 'convention pinned', 'context restored'],
  },
  {
    slug: 'guard', name: 'Codexyy Guard', shortName: 'Guard', color: '#FF4057', rgb: '255,64,87',
    eyebrow: 'Security built into the coding flow', headline: 'Find the exposure.', accentLine: 'Fix it before release.',
    description: 'Scan repositories and proposed changes for secrets, vulnerable dependencies, unsafe authentication, and risky configuration—with remediation attached.',
    summary: 'Secret detection, security scanning, alerts, and remediation.', price: '$10', cadence: '/ repository / month', priceDetail: 'Every repository receives basic secret scanning free.', command: 'cxy guard scan',
    features: [
      { title: 'Secret detection', description: 'Catch credentials and private keys before they are published.' },
      { title: 'Dependency intelligence', description: 'Explain vulnerable packages and the safest available update path.' },
      { title: 'Authentication review', description: 'Inspect cookies, origins, sessions, redirects, and permission boundaries.' },
      { title: 'Threat models', description: 'Generate a practical view of assets, actors, entry points, and controls.' },
      { title: 'Suggested remediation', description: 'Prepare focused patches for each confirmed finding.' },
      { title: 'Scheduled scans', description: 'Watch unchanged repositories as new vulnerabilities are disclosed.' },
      { title: 'Security history', description: 'Track when a risk appeared, changed, and was resolved.' },
      { title: 'Exportable reports', description: 'Share an evidence-backed security summary when required.' },
    ],
    steps: [
      { title: 'Scan the repository', description: 'Combine static checks with context-aware security review.' },
      { title: 'Triage the findings', description: 'Prioritize exploitable issues over generic warnings.' },
      { title: 'Apply and document fixes', description: 'Patch the issue and retain the evidence for later.' },
    ], preview: ['secret blocked', 'dependency patched', 'risk reduced'],
  },
  {
    slug: 'marketplace', name: 'Codexyy Marketplace', shortName: 'Marketplace', color: '#FFB020', rgb: '255,176,32',
    eyebrow: 'Extend the agent with work worth sharing', headline: 'Find your next workflow.', accentLine: 'Or publish it.',
    description: 'Discover trusted skills, project starters, automations, themes, and model configurations—with permissions and compatibility shown before installation.',
    summary: 'Skills, templates, themes, automations, and configurations.', price: 'Free', cadence: 'to browse', priceDetail: 'Codexyy keeps 15% of paid creator sales.', command: 'cxy add',
    features: [
      { title: 'One-command installation', description: 'Add a product without manually copying configuration or files.' },
      { title: 'Permission disclosure', description: 'See files, tools, network access, and secrets required before install.' },
      { title: 'Verified creators', description: 'Know who maintains a listing and how support is handled.' },
      { title: 'Live previews', description: 'Understand the generated result before adding it to a project.' },
      { title: 'Compatibility checks', description: 'Confirm CLI, agent, operating system, and model requirements.' },
      { title: 'Automatic updates', description: 'Receive safe upgrades with visible changes and rollback support.' },
      { title: 'Private listings', description: 'Share internal tools only with an approved Codexyy Team.' },
      { title: 'Creator revenue', description: 'Publish paid work with analytics, versions, and payouts.' },
    ],
    steps: [
      { title: 'Explore clearly', description: 'Search by job, language, permission, price, or compatibility.' },
      { title: 'Review before install', description: 'Inspect exactly what the listing adds and can access.' },
      { title: 'Build on the ecosystem', description: 'Use it privately or publish your own version.' },
    ], preview: ['permissions clear', 'version compatible', 'skill installed'],
  },
  {
    slug: 'pulse', name: 'Codexyy Pulse', shortName: 'Pulse', color: '#62C6FF', rgb: '98,198,255',
    eyebrow: 'Know what production is doing', headline: 'See the incident.', accentLine: 'Shorten the recovery.',
    description: 'Monitor websites and APIs, collect the incident timeline, alert the right people, and hand the evidence directly to the Codexyy agent.',
    summary: 'Monitoring, incidents, status pages, and agent-assisted fixes.', price: '$8', cadence: '/ month', priceDetail: 'Three uptime monitors are included free.',
    features: [
      { title: 'Uptime monitoring', description: 'Check websites and APIs from multiple locations.' },
      { title: 'Latency history', description: 'Spot slow degradation before it becomes downtime.' },
      { title: 'Incident timelines', description: 'Keep alerts, logs, deployments, and actions in one order.' },
      { title: 'Status pages', description: 'Publish a clear customer-facing view of current health.' },
      { title: 'Domain and TLS warnings', description: 'Catch expiring certificates and domain configuration failures.' },
      { title: 'Targeted alerts', description: 'Notify by email or webhook without repeating the same incident.' },
      { title: 'Agent investigation', description: 'Give Codexyy the relevant logs and repository context immediately.' },
      { title: 'Post-incident reports', description: 'Generate a factual review of impact, response, and prevention.' },
    ],
    steps: [
      { title: 'Add a monitor', description: 'Choose the endpoint, frequency, and expected result.' },
      { title: 'Capture the evidence', description: 'Pulse groups related failures into one incident.' },
      { title: 'Investigate and improve', description: 'Open the evidence in Codexyy and prepare the fix.' },
    ], preview: ['latency normal', 'incident grouped', 'team notified'],
  },
  {
    slug: 'one', name: 'Codexyy One', shortName: 'One', color: '#F8F7FF', rgb: '248,247,255',
    eyebrow: 'One subscription for the complete platform', headline: 'Everything Codexyy.', accentLine: 'One membership.',
    description: 'Bring every Codexyy product together with larger included allowances, one usage view, priority routing, and early access to what ships next.',
    summary: 'Every Codexyy product with generous included allowances.', price: '$39', cadence: '/ month', priceDetail: '$390 annually. Metered compute and extra seats remain separate.',
    features: [
      { title: 'Every Pro model', description: 'Use the complete hosted-model catalog with priority routing.' },
      { title: 'Every Codexyy product', description: 'Deploy, Teams, Review, Automate, Workspaces, Memory, Guard, Marketplace, and Pulse.' },
      { title: 'Larger allowances', description: 'Start every product with a practical monthly usage allocation.' },
      { title: 'One usage dashboard', description: 'Understand model, compute, automation, monitoring, and storage use together.' },
      { title: 'One monthly payment', description: 'Replace a stack of add-ons with one predictable membership.' },
      { title: 'Priority support', description: 'Reach the Codexyy team through an accelerated support queue.' },
      { title: 'Early access', description: 'Try new Codexyy products before their general release.' },
      { title: 'Annual savings', description: 'Get two months included when choosing the annual membership.' },
    ],
    steps: [
      { title: 'Activate One', description: 'Your account receives access across the whole platform.' },
      { title: 'Use what you need', description: 'Products appear in one dashboard with their included allowances.' },
      { title: 'Grow without rebuilding', description: 'Add usage or seats while keeping the same account and workflow.' },
    ], preview: ['all products active', 'priority routing on', 'one bill'],
  },
]

export const PRODUCT_BY_SLUG = Object.fromEntries(
  PRODUCTS.map(product => [product.slug, product]),
) as Record<string, Product>
