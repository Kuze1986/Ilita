import type { ProductKey } from "@/types/demo";

export const PRODUCT_LABELS: Record<ProductKey, string> = {
  keystone: "Keystone",
  meridian: "Meridian",
  scripta: "Scripta",
  rxblitz: "RxBlitz",
  bioloop: "BioLoop",
};

export const ORG_TYPE_OPTIONS = [
  { value: "hospital", label: "Hospital / health system" },
  { value: "workforce_nonprofit", label: "Workforce / nonprofit" },
  { value: "pharmacy_chain", label: "Pharmacy / retail chain" },
  { value: "individual", label: "Individual learner" },
  { value: "other", label: "Other" },
] as const;

export type OrgTypeValue = (typeof ORG_TYPE_OPTIONS)[number]["value"];

export const ROLE_OPTIONS = [
  { value: "Workforce program director", personaHint: "workforce_admin" as const },
  { value: "Pharmacy director / clinical educator", personaHint: "pharmacy_director" as const },
  { value: "Training / L&D coordinator", personaHint: "training_coordinator" as const },
  { value: "Student / certification candidate", personaHint: "individual_learner" as const },
  { value: "Executive / VP", personaHint: "executive" as const },
  { value: "IT / systems evaluator", personaHint: "it_evaluator" as const },
  { value: "Other", personaHint: "unknown" as const },
];

export const PAIN_POINT_OPTIONS = [
  "Staff turnover & onboarding load",
  "Compliance & accreditation pressure",
  "Scaling training across sites",
  "Learner engagement & completion",
  "LMS / content modernization",
  "Certification pass rates",
  "Data & outcomes visibility",
  "AI / automation evaluation",
] as const;

export const SCORING_WEIGHTS = {
  completionMax: 30,
  attentionMax: 25,
  intentMax: 25,
  liveMax: 20,
} as const;

export const SCORING_RULES_DESCRIPTION = [
  `Completion (max ${SCORING_WEIGHTS.completionMax}): modules completed ÷ total × ${SCORING_WEIGHTS.completionMax}.`,
  `Attention (max ${SCORING_WEIGHTS.attentionMax}): time on module vs expected duration; under expected caps partial credit.`,
  `Intent (max ${SCORING_WEIGHTS.intentMax}): CTA clicks and module replays.`,
  `Live Kuze (max ${SCORING_WEIGHTS.liveMax}): live mode started plus message volume.`,
] as const;

export const ENGAGEMENT_THRESHOLDS = {
  hot: 80,
  warm: 50,
  cool: 20,
} as const;

export const DEMO_PRODUCT_CARDS: {
  id: ProductKey | "unsure";
  title: string;
  blurb: string;
}[] = [
  {
    id: "keystone",
    title: "Keystone",
    blurb: "Workforce programs, onboarding, compliance at scale",
  },
  {
    id: "scripta",
    title: "Scripta",
    blurb: "LMS-ready content and structured learning paths",
  },
  {
    id: "rxblitz",
    title: "RxBlitz",
    blurb: "Certification prep for pharmacy technicians",
  },
  {
    id: "bioloop",
    title: "BioLoop",
    blurb: "Behavioral intelligence and outcomes analytics",
  },
  {
    id: "meridian",
    title: "Meridian",
    blurb: "Pharmacy education and clinical training",
  },
  {
    id: "unsure",
    title: "Not sure",
    blurb: "Route me to the best-fit demo",
  },
];
