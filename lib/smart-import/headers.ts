import type { Field } from "./types";
import { normalizeName } from "./normalization";

const aliases: Record<string, Field> = {
  CAMPAIGN: "campaign", "CAMPAIGN NAME": "campaign", ACCOUNT: "campaign", PROGRAM: "campaign",
  "GOAL TYPE": "goalType", KPI: "goalType", "KPI TYPE": "goalType", METRIC: "goalType", "METRIC TYPE": "goalType",
  SEAT: "seat", SEATS: "seat", "SEAT COUNT": "seat", "DECLARED SEAT": "seat",
  GOAL: "target", TARGET: "target", "MONTHLY GOAL": "target", "MONTHLY TARGET": "target",
  MTD: "mtd", ACTUAL: "mtd", "MONTH TO DATE": "mtd", "MONTHLY ACTUAL": "mtd",
  ACHIEVEMENT: "achievement", "ACHIEVEMENT RATE": "achievement", ATTAINMENT: "achievement",
  RR: "runRate", "RUN RATE": "runRate", RUNRATE: "runRate",
  "RR ACHIEVEMENT": "rrAchievement", "RUN RATE ACHIEVEMENT": "rrAchievement",
  WDAYS: "workingDays", "WORKING DAYS": "workingDays", "WORK DAYS": "workingDays",
  "DAYS LAPSED": "daysLapse", "DAYS LAPSE": "daysLapse", "ELAPSED DAYS": "daysLapse",
  DATE: "dateUpdated", "REPORT DATE": "dateUpdated", "DATE UPDATED": "dateUpdated", "AS OF": "dateUpdated",
};
export function identifyHeader(header: unknown): Field | null {
  const text = normalizeName(header);
  const week = text.match(/^(?:W|WK|WEEK)\s*0?([1-5])$/);
  return week ? `week${week[1]}` as Field : aliases[text] ?? null;
}
