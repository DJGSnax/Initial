// Types shared by the server, the admin app and the embed snippet.

export type PromptType = "tooltip" | "hotspot" | "modal" | "banner" | "tour";
export type PromptStatus = "draft" | "live" | "paused" | "archived";

export type Placement = "auto" | "top" | "bottom" | "left" | "right";

export interface PromptStep {
  id: string;
  /** CSS selector of the element to anchor to. Empty means centered (tours/modals). */
  selector?: string;
  title: string;
  /** Markdown, rendered and sanitized by the server before it reaches the snippet. */
  body: string;
  bodyHtml?: string;
  placement?: Placement;
  /** Opens this knowledge base article in the widget. */
  articleSlug?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Tours only: highlight the target element with a dimmed backdrop. */
  spotlight?: boolean;
  /** Tours only: advance when the user clicks the target instead of "Next". */
  advanceOnClick?: boolean;
}

export type UrlOp = "contains" | "equals" | "starts_with" | "glob" | "regex";
export interface UrlRule {
  op: UrlOp;
  value: string;
  exclude?: boolean;
}

export type TraitOp = "eq" | "neq" | "in" | "not_in" | "gt" | "lt" | "exists" | "not_exists";
export interface TraitRule {
  key: string;
  op: TraitOp;
  value?: string | number | boolean | string[];
}

export interface Targeting {
  urlRules: UrlRule[];
  traitRules: TraitRule[];
  audience: "all" | "identified" | "anonymous";
}

export type TriggerType =
  | "page_load"
  | "delay"
  | "scroll"
  | "element_click"
  | "custom_event"
  | "rage_click"
  | "idle"
  | "repeat_visit"
  | "exit_intent";

export interface Trigger {
  type: TriggerType;
  delayMs?: number;
  scrollPct?: number;
  selector?: string;
  eventName?: string;
  idleMs?: number;
  /** repeat_visit: show after this many views of a matching page in one session */
  visits?: number;
}

export type FrequencyMode = "once" | "once_per_session" | "every_time" | "until_dismissed" | "every_n_days";
export interface Frequency {
  mode: FrequencyMode;
  days?: number;
  maxImpressions?: number;
}

export interface PromptTheme {
  accent?: string;
  /** banners */
  position?: "top" | "bottom";
  /** modals */
  size?: "sm" | "md" | "lg";
  dismissible?: boolean;
  /** hotspots: show a pulsing beacon that opens the tooltip on click */
  beacon?: boolean;
}

export interface PromptDefinition {
  steps: PromptStep[];
  targeting: Targeting;
  trigger: Trigger;
  frequency: Frequency;
  theme: PromptTheme;
}

export interface PromptRecord extends PromptDefinition {
  id: number;
  name: string;
  type: PromptType;
  status: PromptStatus;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/** What the snippet receives: only live prompts, already rendered. */
export interface EmbedPrompt extends PromptDefinition {
  id: number;
  type: PromptType;
  priority: number;
  version: string;
}

export interface LauncherSettings {
  enabled: boolean;
  position: "bottom-right" | "bottom-left";
  label: string;
  accent: string;
  greeting: string;
  /** URL rules for where the launcher appears; empty = everywhere */
  urlRules: UrlRule[];
}

export type StorageMode = "consent_required" | "functional_allowed";

export interface PrivacySettings {
  /** Analytics identifiers are only used after kb('consent', { analytics: true }) */
  requireConsent: boolean;
  /** Honour Global Privacy Control and Do Not Track as a consent refusal */
  respectGpc: boolean;
  /** Whether frequency caps and tour progress may use localStorage before consent */
  storage: StorageMode;
  /** Trait keys the snippet may send. Everything else is dropped. */
  allowedTraits: string[];
  /** Events and searches older than this are deleted */
  retentionDays: number;
  /** What page context AI nudges may read: just the URL path, or path + title + h1 */
  nudgeContext: "path_only" | "path_and_headings";
}

export interface AiSettings {
  overview: boolean;
  nudges: boolean;
  /** Minimum gap between two AI nudges for the same browser session */
  nudgeCooldownMin: number;
}

export interface Settings {
  siteName: string;
  allowedOrigins: string[];
  launcher: LauncherSettings;
  privacy: PrivacySettings;
  ai: AiSettings;
}

export interface EmbedConfig {
  siteName: string;
  baseUrl: string;
  prompts: EmbedPrompt[];
  launcher: LauncherSettings;
  privacy: Omit<PrivacySettings, "retentionDays">;
  ai: { overview: boolean; nudges: boolean; available: boolean };
}

export type EventType =
  | "page_view"
  | "prompt_shown"
  | "prompt_dismissed"
  | "prompt_cta"
  | "tour_step"
  | "tour_completed"
  | "article_view"
  | "launcher_open"
  | "rage_click"
  | "idle"
  | "nudge_shown"
  | "nudge_clicked"
  | "nudge_dismissed"
  | "article_feedback"
  | "custom";

export const EVENT_TYPES: EventType[] = [
  "page_view",
  "prompt_shown",
  "prompt_dismissed",
  "prompt_cta",
  "tour_step",
  "tour_completed",
  "article_view",
  "launcher_open",
  "rage_click",
  "idle",
  "nudge_shown",
  "nudge_clicked",
  "nudge_dismissed",
  "article_feedback",
  "custom",
];

export interface IncomingEvent {
  type: EventType;
  ts?: number;
  path?: string;
  promptId?: number;
  articleSlug?: string;
  step?: number;
  name?: string;
  props?: Record<string, string | number | boolean>;
}

export interface EventBatch {
  /** Present only when analytics consent was given */
  sessionId?: string;
  /** Pseudonymous id from kb('identify'), present only with consent */
  visitorId?: string;
  traits?: Record<string, string | number | boolean>;
  events: IncomingEvent[];
}

export interface SearchHit {
  id: number;
  slug: string;
  title: string;
  summary: string;
  snippet: string;
  collection: string | null;
  score: number;
}

export interface BehaviorSignal {
  type: "rage_click" | "idle" | "repeat_visit" | "search_no_click" | "back_and_forth" | "error_text";
  count?: number;
  /** short, PII-scrubbed label of the element involved (aria-label or text) */
  label?: string;
}

export interface NudgeRequest {
  sessionId: string;
  path: string;
  title?: string;
  headings?: string[];
  signals: BehaviorSignal[];
  recentSearches?: string[];
}

export interface NudgeResponse {
  show: boolean;
  message?: string;
  article?: { slug: string; title: string; summary: string };
  source?: "ai" | "rules";
}
